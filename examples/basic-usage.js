/**
 * Basic Usage Examples - Claude Agent SDK Code Execution
 * 
 * This file demonstrates the simplest way to use Claude's built-in
 * code execution for data analysis tasks.
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Example 1: Simple Statistical Analysis
 */
async function example1_statistics() {
  console.log('\n📊 Example 1: Basic Statistics\n');

  const data = `
temperature,humidity,sales
25,60,100
28,65,120
22,55,95
30,70,140
26,62,110
29,68,130
24,58,105
27,64,125
  `.trim();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    tools: [
      {
        type: 'code_execution_20250201',
        name: 'code_execution',
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Analyze this weather and sales data:

${data}

Please:
1. Load the data
2. Calculate descriptive statistics
3. Find correlations between variables
4. Create a visualization

Use pandas and matplotlib.`,
      },
    ],
  });

  console.log('✅ Analysis complete!\n');
  printResults(response);
}

/**
 * Example 2: Data Cleaning and Transformation
 */
async function example2_cleaning() {
  console.log('\n🧹 Example 2: Data Cleaning\n');

  const messyData = `
id,name,age,salary
1,Alice,25,50000
2,Bob,,60000
3,Charlie,35,
4,Diana,28,55000
5,,32,65000
6,Eve,29,58000
  `.trim();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    tools: [
      {
        type: 'code_execution_20250201',
        name: 'code_execution',
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Clean this employee data and provide insights:

${messyData}

Tasks:
1. Load and examine the data
2. Identify missing values
3. Handle missing data appropriately
4. Calculate statistics on clean data
5. Show before/after comparison`,
      },
    ],
  });

  console.log('✅ Cleaning complete!\n');
  printResults(response);
}

/**
 * Example 3: Time Series Analysis
 */
async function example3_timeseries() {
  console.log('\n📈 Example 3: Time Series Analysis\n');

  const timeSeriesData = `
date,revenue,expenses
2024-01-01,10000,7000
2024-01-02,10500,7200
2024-01-03,9800,6900
2024-01-04,11200,7500
2024-01-05,11800,7800
2024-01-06,11500,7600
2024-01-07,12000,8000
2024-01-08,11900,7900
2024-01-09,12500,8200
2024-01-10,12800,8300
  `.trim();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    tools: [
      {
        type: 'code_execution_20250201',
        name: 'code_execution',
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Analyze this business performance data:

${timeSeriesData}

Please:
1. Parse dates correctly
2. Calculate daily profit
3. Show trends over time
4. Create visualizations
5. Provide business insights`,
      },
    ],
  });

  console.log('✅ Analysis complete!\n');
  printResults(response);
}

/**
 * Example 4: Machine Learning - Classification
 */
async function example4_ml() {
  console.log('\n🤖 Example 4: Machine Learning\n');

  const mlData = `
feature1,feature2,feature3,label
2.5,3.1,1.2,A
1.8,2.9,1.1,A
3.2,4.1,2.3,B
2.9,3.8,2.1,B
1.5,2.2,0.9,A
3.8,4.5,2.8,B
2.1,3.3,1.4,A
3.5,4.2,2.5,B
1.9,2.8,1.0,A
3.3,4.0,2.4,B
  `.trim();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    tools: [
      {
        type: 'code_execution_20250201',
        name: 'code_execution',
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Build a simple classifier for this data:

${mlData}

Tasks:
1. Load and explore the data
2. Split into train/test sets
3. Train a classifier (your choice)
4. Evaluate performance
5. Show confusion matrix and accuracy`,
      },
    ],
  });

  console.log('✅ ML model trained!\n');
  printResults(response);
}

/**
 * Example 5: Multi-turn Conversation
 */
async function example5_conversation() {
  console.log('\n💬 Example 5: Multi-turn Analysis\n');

  const data = `
product,price,quantity,category
Widget,25.99,50,Electronics
Gadget,45.50,30,Electronics
Tool,15.75,80,Hardware
Device,89.99,20,Electronics
Implement,22.50,60,Hardware
  `.trim();

  // First message: Initial analysis
  const response1 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    tools: [
      {
        type: 'code_execution_20250201',
        name: 'code_execution',
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Analyze this product inventory:

${data}

Show me total revenue by category.`,
      },
    ],
  });

  console.log('📊 First analysis:\n');
  printResults(response1);

  // Second message: Follow-up question
  const response2 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    tools: [
      {
        type: 'code_execution_20250201',
        name: 'code_execution',
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Analyze this product inventory:

${data}

Show me total revenue by category.`,
      },
      {
        role: 'assistant',
        content: response1.content,
      },
      {
        role: 'user',
        content: 'Now show me average price per category and create a bar chart.',
      },
    ],
  });

  console.log('\n📊 Follow-up analysis:\n');
  printResults(response2);
}

/**
 * Helper function to print results
 */
function printResults(response) {
  for (const block of response.content) {
    if (block.type === 'text') {
      console.log('💬 Response:', block.text);
      console.log();
    } else if (block.type === 'tool_use') {
      console.log('💻 Code executed:');
      console.log('---');
      console.log(block.input.code);
      console.log('---\n');
    } else if (block.type === 'tool_result') {
      if (block.content) {
        for (const item of block.content) {
          if (item.type === 'text') {
            console.log('📤 Output:');
            console.log(item.text);
            console.log();
          } else if (item.type === 'image') {
            console.log(
              `🖼️  Image generated (${item.source.media_type}), ${item.source.data.length} bytes`
            );
            console.log();
          }
        }
      }
    }
  }

  console.log('📊 Token usage:');
  console.log(`   Input: ${response.usage.input_tokens}`);
  console.log(`   Output: ${response.usage.output_tokens}`);
  console.log(`   Total: ${response.usage.input_tokens + response.usage.output_tokens}`);
}

/**
 * Run all examples
 */
async function runAll() {
  console.log('\n🚀 Claude Agent SDK - Basic Usage Examples\n');
  console.log('═'.repeat(60));

  try {
    await example1_statistics();
    console.log('\n' + '═'.repeat(60));

    await example2_cleaning();
    console.log('\n' + '═'.repeat(60));

    await example3_timeseries();
    console.log('\n' + '═'.repeat(60));

    await example4_ml();
    console.log('\n' + '═'.repeat(60));

    await example5_conversation();
    console.log('\n' + '═'.repeat(60));

    console.log('\n✅ All examples completed!\n');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.status) {
      console.error(`   HTTP Status: ${error.status}`);
    }
  }
}

/**
 * Run specific example or all
 */
const example = process.argv[2];

if (example) {
  // Run specific example
  const examples = {
    '1': example1_statistics,
    '2': example2_cleaning,
    '3': example3_timeseries,
    '4': example4_ml,
    '5': example5_conversation,
  };

  if (examples[example]) {
    examples[example]().catch(console.error);
  } else {
    console.error('Invalid example number. Use 1-5 or no argument for all.');
    process.exit(1);
  }
} else {
  // Run all examples
  runAll().catch(console.error);
}

export {
  example1_statistics,
  example2_cleaning,
  example3_timeseries,
  example4_ml,
  example5_conversation,
};


