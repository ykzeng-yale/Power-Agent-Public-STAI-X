import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import path from 'path';
// pdf-parse will be imported dynamically when needed

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// File upload configuration
const upload = multer({ dest: 'uploads/' });

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Main endpoint for data analysis requests
 * Accepts natural language queries and optional data files
 */
app.post('/api/analyze', upload.single('dataFile'), async (req, res) => {
  try {
    const { query, data } = req.body;
    const dataFile = req.file;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`\n📊 Analysis Request: ${query}`);

    // Prepare the analysis prompt
    let prompt = `You are a professional biostatistician and data analysis expert with expertise in R and Python.

CRITICAL INSTRUCTIONS - FOLLOW EXACTLY:
1. **Follow the user's request precisely** - Do exactly what they ask, nothing more, nothing less
2. **If user provides code, RUN IT FIRST** - Execute user-provided code as-is before suggesting modifications
3. **Prioritize user instructions** - User specifications override general best practices
4. **Use appropriate language** - R for biostatistics (power analysis, mixed models, survival analysis), Python for general data science

User Request: "${query}"
`;

    // Handle data input
    let dataContent = null;
    if (dataFile) {
      // Read uploaded file
      dataContent = await fs.readFile(dataFile.path, 'utf-8');
      prompt += `\nData provided in file: ${dataFile.originalname || 'uploaded file'}\n`;
      // Clean up temp file
      await fs.unlink(dataFile.path);
    } else if (data) {
      // Use inline data
      dataContent = data;
      prompt += `\nData provided inline.\n`;
    }

    if (dataContent) {
      prompt += `\nData:\n${dataContent}\n\n`;
    }

    // Detect if user provided code in their query
    const hasCodeBlock = query.includes('```') || query.match(/\b(library|install\.packages|pip install|import |def |function\()/);

    if (hasCodeBlock) {
      prompt += `\n⚠️ IMPORTANT: The user has provided code. YOU MUST:
1. Extract and RUN the user's code FIRST using the bash tool
2. Show the exact output/results from their code
3. Only suggest improvements if explicitly asked
4. Respect their code choices (packages, methods, syntax)

`;
    }

    prompt += `\nExecution Guidelines:
- Use bash tool to execute R or Python code
- For R: Use Rscript or R -e commands
- For Python: Use python3 commands
- Install missing packages on-demand using pak (R) or pip (Python)
- Generate visualizations if appropriate
- Provide clear insights and summary statistics
- Explain findings concisely

Execute the analysis now using the bash tool.`;

    // Create message with Claude SDK
    // Note: Using bash tool for code execution
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: [
        {
          type: 'bash_20250124',
          name: 'bash',
        },
      ],
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    console.log('✅ Analysis complete');

    // Extract results
    const results = processClaudeResponse(response);

    res.json({
      success: true,
      query,
      results,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Process Claude's response to extract code, results, and insights
 */
function processClaudeResponse(response) {
  const results = {
    text: [],
    code: [],
    outputs: [],
    images: [],
  };

  for (const block of response.content) {
    if (block.type === 'text') {
      results.text.push(block.text);
    } else if (block.type === 'tool_use' && block.name === 'code_execution') {
      results.code.push(block.input.code);
    } else if (block.type === 'tool_result') {
      // Parse tool results
      if (block.content) {
        for (const item of block.content) {
          if (item.type === 'text') {
            results.outputs.push(item.text);
          } else if (item.type === 'image') {
            results.images.push({
              format: item.source.media_type,
              data: item.source.data,
            });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Preliminary file analysis endpoint
 * Automatically analyzes uploaded files to provide context for the agent
 * Adaptive to all file types: data, protocols, statistical analysis plans, etc.
 */
app.post('/api/analyze-file', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const { fileName, fileType, fileSize } = req.query;

    console.log(`\n📄 Preliminary Analysis Request: ${fileName} (${fileType || 'unknown type'})`);

    // Validate fileName
    if (!fileName) {
      return res.status(400).json({
        success: false,
        error: 'fileName query parameter is required. Usage: POST /api/analyze-file?fileName=document.pdf'
      });
    }

    // Determine file category
    const ext = fileName.split('.').pop().toLowerCase();
    const isDataFile = ['csv', 'xlsx', 'xls', 'tsv', 'txt', 'sav', 'dta', 'rds', 'rda', 'rdata', 'sas7bdat', 'xpt'].includes(ext);
    const isDocument = ['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext);

    // Extract file content based on type
    let fileContent;
    if (ext === 'pdf') {
      // PDF files: use pdf-parse to extract text
      try {
        console.log('📄 Extracting text from PDF...');
        const pdfBuffer = Buffer.from(req.body);
        const pdfParse = (await import('pdf-parse')).default;
        const pdfData = await pdfParse(pdfBuffer);
        fileContent = pdfData.text;
        console.log(`✅ PDF extraction successful: ${pdfData.numpages} pages, ${fileContent.length} characters`);

        if (!fileContent || fileContent.trim().length === 0) {
          console.warn('⚠️  PDF extracted but no text content found');
          return res.status(400).json({
            error: 'PDF appears to be empty or contains only images. No extractable text found.',
            success: false
          });
        }
      } catch (pdfError) {
        console.error('❌ PDF extraction error:', pdfError);
        return res.status(500).json({
          error: 'Failed to extract text from PDF: ' + pdfError.message,
          success: false
        });
      }
    } else if (ext === 'docx' || ext === 'doc') {
      // DOCX files: use mammoth to extract text from binary ZIP format
      try {
        console.log('📄 Extracting text from DOCX using mammoth...');
        const docBuffer = Buffer.from(req.body);
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer: docBuffer });
        fileContent = result.value;
        console.log(`✅ DOCX extraction successful: ${fileContent.length} characters`);

        if (!fileContent || fileContent.trim().length === 0) {
          console.warn('⚠️  DOCX extracted but no text content found');
          return res.status(400).json({
            error: 'DOCX appears to be empty. No extractable text found.',
            success: false
          });
        }
      } catch (docError) {
        console.error('❌ DOCX extraction error:', docError);
        return res.status(500).json({
          error: 'Failed to extract text from DOCX: ' + docError.message,
          success: false
        });
      }
    } else {
      // Text-based files: convert buffer to UTF-8 string
      fileContent = req.body.toString('utf-8');
    }

    if (!fileName || !fileContent) {
      return res.status(400).json({ error: 'fileName and file content are required' });
    }

    let analysisPrompt = `You are a professional biostatistician receiving a file from a colleague. Perform a quick preliminary analysis of this file.

File: ${fileName}
Type: ${fileType || ext}
Size: ${fileSize || 'unknown'}

`;

    if (isDataFile) {
      analysisPrompt += `This appears to be a DATA FILE. As a biostatistician would do upon receiving data, provide:

1. **Data Structure**: Number of rows, columns, overall shape
2. **Variables/Columns**: List all column names with their apparent data types (numeric, categorical, date, etc.)
3. **Data Quality**: Missing values, duplicates, obvious data issues
4. **Key Observations**: What kind of study/analysis this data might support (e.g., potential outcome variables, treatment/group indicators, covariates for adjustment)
5. **Statistical Notes**: Immediate statistical considerations (e.g., sample size adequacy, potential confounders visible, whether data supports power analysis, group balance, effect size estimation feasibility)

`;
    } else if (isDocument) {
      analysisPrompt += `This appears to be a DOCUMENT. Analyze and extract:

1. **Document Type**: Protocol, Statistical Analysis Plan (SAP), Study Report, or other
2. **Research Question**: What question is being asked or investigated?
3. **Key Objectives**: Primary and secondary objectives if stated
4. **Study Design**: Type of study (RCT, observational, etc.) and design elements
5. **Data Requirements**: What data or variables are needed
6. **Analysis Methods**: Statistical methods mentioned or required
7. **Expected Outcomes**: What results or deliverables are expected

`;
    } else {
      analysisPrompt += `Analyze this file and provide:

1. **File Purpose**: What is this file for?
2. **Key Content**: Main information or data contained
3. **Relevant Details**: Important details a biostatistician should know
4. **Usage Context**: How might this file be used in statistical analysis?

`;
    }

    analysisPrompt += `
File Content (first 5000 characters):
${fileContent.substring(0, 5000)}

Provide a concise, professional preliminary analysis. Format your response in clear sections. Be specific and factual. If you cannot fully determine something, state what you can observe.`;

    // Use Claude Sonnet 4.6 for preliminary analysis
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      temperature: 0.3, // Lower temperature for consistent, factual analysis
      messages: [
        {
          role: 'user',
          content: analysisPrompt,
        },
      ],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    const analysis = textBlock ? textBlock.text : '';

    console.log('✅ Preliminary analysis complete');

    res.json({
      success: true,
      fileName,
      fileType,
      analysis,
      extractedText: fileContent, // Return the full extracted content
      analyzedAt: new Date().toISOString(),
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (error) {
    console.error('❌ Preliminary analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'claude-data-analysis' });
});

/**
 * Example endpoint showing available analysis types
 */
app.get('/api/examples', (req, res) => {
  res.json({
    examples: [
      {
        title: 'Descriptive Statistics',
        query: 'Calculate mean, median, std dev, and create a histogram',
        sampleData: '1,2,3,4,5,6,7,8,9,10',
      },
      {
        title: 'Correlation Analysis',
        query: 'Calculate correlation matrix and create a heatmap',
        sampleData: 'x,y,z\n1,2,3\n2,4,5\n3,6,7\n4,8,9',
      },
      {
        title: 'Time Series Analysis',
        query: 'Analyze trends and create a time series plot',
        sampleData: 'date,value\n2024-01-01,100\n2024-01-02,105\n2024-01-03,103',
      },
      {
        title: 'Regression Analysis',
        query: 'Perform linear regression and show the results',
        sampleData: 'x,y\n1,2\n2,4\n3,6\n4,8\n5,10',
      },
    ],
  });
});

// Start server only when not in Vercel serverless environment
if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`\n🚀 Claude Data Analysis Backend running on port ${port}`);
    console.log(`📍 Endpoints:`);
    console.log(`   POST /api/analyze - Submit analysis request`);
    console.log(`   GET  /api/examples - View example requests`);
    console.log(`   GET  /health - Health check\n`);
  });
}

export default app;

