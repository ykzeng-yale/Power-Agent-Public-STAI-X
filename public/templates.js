// Power Agent Templates - Structured Query Builder
// Version: 1.0.0

const POWER_AGENT_TEMPLATES = [
  // ========================================
  // TIER 1: BASIC COMPARISONS
  // ========================================
  {
    id: "t-test",
    tier: 1,
    title: "Two-Sample T-Test",
    description: "Compare means between two independent groups",
    icon: "📊",
    category: "Basic Comparisons",
    autoFillExample: "I want to compare mean systolic blood pressure between a new antihypertensive drug and placebo using a two-sample t-test. Based on pilot data, I expect a mean difference of 5 mmHg (control mean ~140 mmHg, treatment mean ~135 mmHg) with SD of 12 mmHg in both groups. I need 80% power with a two-sided test at alpha 0.05 to detect this difference. Please calculate the required sample size per group and show me a power curve.",
    questions: [
      {
        id: "q1",
        label: "What is your research question?",
        type: "textarea",
        placeholder: "e.g., Compare blood pressure between treatment and control groups",
        required: true,
        helpText: "Describe what you want to compare between the two groups"
      },
      {
        id: "q2",
        label: "What effect size do you expect (Cohen's d)?",
        type: "number",
        placeholder: "0.5",
        required: true,
        helpText: "Small: 0.2, Medium: 0.5, Large: 0.8",
        validation: { min: 0.1, max: 2.0 }
      },
      {
        id: "q3",
        label: "What statistical power do you need?",
        type: "select",
        options: [
          { value: "0.80", label: "80% (standard)" },
          { value: "0.90", label: "90% (high)" },
          { value: "0.95", label: "95% (very high)" }
        ],
        required: true,
        helpText: "80% is the conventional standard in most fields"
      },
      {
        id: "q4",
        label: "Significance level (alpha)?",
        type: "select",
        options: [
          { value: "0.05", label: "0.05 (standard)" },
          { value: "0.01", label: "0.01 (stringent)" }
        ],
        required: true,
        helpText: "Type I error rate - typically 0.05"
      },
      {
        id: "q5",
        label: "Do you want visualizations?",
        type: "checkbox",
        options: [
          { value: "power_curve", label: "Power curve plot" },
          { value: "effect_size_plot", label: "Effect size visualization" }
        ],
        helpText: "Select plots to generate"
      }
    ],
    buildQuery: function(answers) {
      const parts = [
        `Research Question: ${answers.q1}`,
        ``,
        `Please perform a two-sample t-test power analysis with the following specifications:`,
        `- Expected effect size (Cohen's d): ${answers.q2}`,
        `- Desired statistical power: ${parseFloat(answers.q3) * 100}%`,
        `- Significance level (alpha): ${answers.q4}`,
        ``
      ];

      if (answers.q5 && answers.q5.length > 0) {
        parts.push(`Visualizations requested:`);
        if (answers.q5.includes('power_curve')) {
          parts.push(`- Generate a power curve showing the relationship between sample size and statistical power`);
        }
        if (answers.q5.includes('effect_size_plot')) {
          parts.push(`- Create an effect size visualization`);
        }
        parts.push(``);
      }

      parts.push(`Please:`);
      parts.push(`1. Calculate the required sample size per group`);
      parts.push(`2. Provide interpretation of the results`);
      parts.push(`3. Generate all requested visualizations`);
      parts.push(`4. Save results to CSV and create a comprehensive report`);

      return parts.join('\n');
    }
  },

  // ========================================
  // TIER 2: REGRESSION & MODELS
  // ========================================
  {
    id: "mixed-model",
    tier: 2,
    title: "Linear Mixed Effects Model",
    description: "Power analysis for hierarchical/clustered data",
    icon: "🔬",
    category: "Regression & Models",
    autoFillExample: "I'm planning a study with patients nested within 20 clinics. I expect 30 patients per clinic (600 total patients). The treatment effect size is 0.3 (standardized Cohen's d), and the intraclass correlation (ICC) is about 0.05. I need 80% power with alpha 0.05 to detect the treatment effect. The mixed model will include random intercepts for clinics: (1|clinic). Can you help me determine if this design is adequate and calculate power for this clustered design?",
    questions: [
      {
        id: "q1",
        label: "Describe your study design",
        type: "textarea",
        placeholder: "e.g., Patients nested within clinics, repeated measures over time",
        required: true,
        helpText: "Explain the hierarchical structure of your data"
      },
      {
        id: "q2",
        label: "What is the treatment effect size?",
        type: "number",
        placeholder: "0.3",
        required: true,
        helpText: "Expected standardized effect (Cohen's d or similar)",
        validation: { min: 0.1, max: 2.0 }
      },
      {
        id: "q3",
        label: "Number of clusters (e.g., clinics, schools)",
        type: "number",
        placeholder: "20",
        required: true,
        helpText: "How many higher-level units?",
        validation: { min: 2, max: 1000 }
      },
      {
        id: "q4",
        label: "Expected observations per cluster",
        type: "number",
        placeholder: "30",
        required: true,
        helpText: "Average number of subjects per cluster",
        validation: { min: 2, max: 1000 }
      },
      {
        id: "q5",
        label: "Intraclass correlation (ICC)",
        type: "number",
        placeholder: "0.05",
        required: true,
        helpText: "Correlation between observations within clusters (typical: 0.01-0.20)",
        validation: { min: 0, max: 0.99 }
      },
      {
        id: "q6",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      },
      {
        id: "q7",
        label: "Do you have pilot data?",
        type: "radio",
        options: [
          { value: "yes", label: "Yes, I have pilot data" },
          { value: "no", label: "No, use assumptions only" }
        ],
        helpText: "Pilot data can improve power estimates"
      }
    ],
    buildQuery: function(answers) {
      const parts = [
        `Study Design: ${answers.q1}`,
        ``,
        `Please perform a power analysis for a linear mixed effects model with:`,
        ``,
        `**Study Parameters:**`,
        `- Treatment effect size: ${answers.q2}`,
        `- Number of clusters: ${answers.q3}`,
        `- Observations per cluster: ${answers.q4}`,
        `- Intraclass correlation (ICC): ${answers.q5}`,
        `- Desired power: ${parseFloat(answers.q6) * 100}%`,
        `- Significance level: 0.05`,
        ``
      ];

      if (answers.q7 === 'yes') {
        parts.push(`**Note:** User has pilot data available for parameter estimation.`);
        parts.push(``);
      }

      parts.push(`Please:`);
      parts.push(`1. Calculate the required sample size accounting for clustering`);
      parts.push(`2. Explain the design effect and variance inflation`);
      parts.push(`3. Create power curves for different ICC scenarios`);
      parts.push(`4. Provide recommendations for cluster size vs. number of clusters`);
      if (answers.q7 === 'yes') {
        parts.push(`5. Show how pilot data can be used to refine these estimates`);
      }
      parts.push(`6. Generate comprehensive visualizations and export results`);

      return parts.join('\n');
    }
  },

  // ========================================
  // TIER 3: ADVANCED DESIGNS
  // ========================================
  {
    id: "simulation-power",
    tier: 3,
    title: "Power Analysis via Simulation",
    description: "Simulation-based power for complex designs",
    icon: "🎲",
    category: "Advanced Designs",
    autoFillExample: "I'm planning a 3-arm trial (Control, Drug A, Drug B) with repeated measures at 4 time points (baseline, 3mo, 6mo, 12mo) across 10 clinical sites with 200 total participants (67 per arm). The mixed model has random intercepts for subjects and sites: (1|subject) + (1|site). Based on pilot data (n=30), I estimate subject variance σ²_subject = 0.8, site variance σ²_site = 0.2, residual variance σ²_ε = 1.0. I expect a main treatment effect of Cohen's d = 0.5 (Drug A vs Control mean difference = 5 units on a 0-100 scale, SD=10) and a treatment-by-time interaction of d = 0.3 (3 units additional improvement at 12mo). I want to test sample sizes of 50, 100, 150, and 200 subjects total using 500 Monte Carlo simulations per scenario. I need 80% power with alpha 0.05 to detect the main treatment effect. The design effect from clustering is approximately 1.18 (ICC_site = 0.02). Please use the simr package to conduct simulation-based power analysis and show me power curves with 95% confidence intervals.",
    questions: [
      {
        id: "q1",
        label: "Describe your complex study design",
        type: "textarea",
        placeholder: "e.g., 3-arm trial with repeated measures, mixed models with (1|subject) + (1|site)",
        required: true,
        helpText: "Include all design features: randomization, nesting, repeated measures, etc."
      },
      {
        id: "q2",
        label: "Treatment effect size(s)",
        type: "text",
        placeholder: "0.5 for main effect, 0.3 for interaction",
        required: true,
        helpText: "List all relevant effect sizes"
      },
      {
        id: "q3",
        label: "Expected sample size range",
        type: "text",
        placeholder: "50, 100, 150, 200",
        required: true,
        helpText: "Comma-separated values to test via simulation"
      },
      {
        id: "q4",
        label: "Number of simulation iterations",
        type: "select",
        options: [
          { value: "100", label: "100 (quick test)" },
          { value: "500", label: "500 (standard)" },
          { value: "1000", label: "1000 (precise)" }
        ],
        required: true,
        helpText: "More iterations = more accurate but slower"
      },
      {
        id: "q5",
        label: "Random effects structure",
        type: "textarea",
        placeholder: "(1|subject) + (1|site)",
        required: true,
        helpText: "Specify random effects in lme4 syntax"
      },
      {
        id: "q6",
        label: "Do you have pilot data for parameter estimation?",
        type: "radio",
        options: [
          { value: "yes", label: "Yes, use pilot data" },
          { value: "no", label: "No, use literature values" }
        ],
        required: true,
        helpText: "Pilot data provides better parameter estimates"
      },
      {
        id: "q7",
        label: "What outputs do you need?",
        type: "checkbox",
        options: [
          { value: "power_curve", label: "Power curve across sample sizes" },
          { value: "param_sensitivity", label: "Sensitivity to parameter assumptions" },
          { value: "simulation_diagnostics", label: "Simulation diagnostics" }
        ],
        helpText: "Select all that apply"
      }
    ],
    buildQuery: function(answers) {
      const parts = [
        `Study Design: ${answers.q1}`,
        ``,
        `Please perform a **simulation-based power analysis** using the simr package with:`,
        ``,
        `**Design Specifications:**`,
        `- Treatment effect(s): ${answers.q2}`,
        `- Sample sizes to test: ${answers.q3}`,
        `- Number of simulations: ${answers.q4} iterations`,
        `- Random effects: ${answers.q5}`,
        `- Alpha level: 0.05`,
        ``
      ];

      if (answers.q6 === 'yes') {
        parts.push(`**Parameter Estimation:** Use pilot data to estimate variance components and effect sizes.`);
        parts.push(``);
      } else {
        parts.push(`**Parameter Estimation:** Use literature-based values for variance components.`);
        parts.push(``);
      }

      parts.push(`**Critical Requirements:**`);
      parts.push(`⚠️ Use simr package for simulation-based power analysis`);
      parts.push(`⚠️ Properly specify the mixed model with random effects: ${answers.q5}`);
      parts.push(`⚠️ Ensure treatment assignment is correctly modeled in the simulation`);
      parts.push(``);

      parts.push(`**Analysis Steps:**`);
      parts.push(`1. Fit the initial mixed model with specified random effects`);
      parts.push(`2. Set fixed effects to match expected treatment effects`);
      if (answers.q6 === 'yes') {
        parts.push(`3. Extract variance components from pilot data`);
      }
      parts.push(`4. Run powerSim() for each sample size in: ${answers.q3}`);
      parts.push(`5. Generate power curve showing power vs. sample size`);

      if (answers.q7 && answers.q7.includes('param_sensitivity')) {
        parts.push(`6. Conduct sensitivity analysis for key parameters`);
      }
      if (answers.q7 && answers.q7.includes('simulation_diagnostics')) {
        parts.push(`7. Provide simulation diagnostics (convergence, distribution checks)`);
      }

      parts.push(``);
      parts.push(`**Outputs:**`);
      parts.push(`- Power estimates for each sample size`);
      parts.push(`- Power curve visualization`);
      parts.push(`- Detailed simulation results table`);
      parts.push(`- Recommendations for final sample size`);
      if (answers.q7 && answers.q7.length > 0) {
        parts.push(`- Additional outputs: ${answers.q7.join(', ')}`);
      }

      return parts.join('\n');
    }
  },

  // ========================================
  // TIER 1: ONE-WAY ANOVA
  // ========================================
  {
    id: "anova-oneway",
    tier: 1,
    title: "One-Way ANOVA",
    description: "Compare means across 3+ independent groups",
    icon: "📈",
    category: "Basic Comparisons",
    autoFillExample: "I need to compare pain reduction across 4 different treatment groups using a one-way ANOVA: placebo, low-dose drug, medium-dose drug, and high-dose drug. I expect a medium effect size (Cohen's f = 0.25), which corresponds to moderate differences in mean pain scores between groups. I need 80% power with alpha 0.05 to detect these differences. Please calculate the required sample size per group and show me a power curve.",
    questions: [
      {
        id: "q1",
        label: "Research question",
        type: "textarea",
        placeholder: "e.g., Compare pain reduction across 4 treatment groups",
        required: true,
        helpText: "What are you comparing across groups?"
      },
      {
        id: "q2",
        label: "Number of groups",
        type: "number",
        placeholder: "4",
        required: true,
        helpText: "How many independent groups to compare?",
        validation: { min: 3, max: 10 }
      },
      {
        id: "q3",
        label: "Effect size (Cohen's f)",
        type: "select",
        options: [
          { value: "0.10", label: "Small (0.10)" },
          { value: "0.25", label: "Medium (0.25)" },
          { value: "0.40", label: "Large (0.40)" }
        ],
        required: true,
        helpText: "Expected effect size for ANOVA"
      },
      {
        id: "q4",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      },
      {
        id: "q5",
        label: "Significance level",
        type: "select",
        options: [
          { value: "0.05", label: "0.05" },
          { value: "0.01", label: "0.01" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Research Question: ${answers.q1}`,
        ``,
        `Please perform a power analysis for a **one-way ANOVA** with:`,
        `- Number of groups: ${answers.q2}`,
        `- Effect size (Cohen's f): ${answers.q3}`,
        `- Desired power: ${parseFloat(answers.q4) * 100}%`,
        `- Alpha: ${answers.q5}`,
        ``,
        `Please:`,
        `1. Calculate required sample size per group`,
        `2. Calculate total sample size needed`,
        `3. Create a power curve showing power vs. sample size`,
        `4. Explain the interpretation in the context of ${answers.q2} groups`,
        `5. Provide guidance on post-hoc comparisons`,
        `6. Save results and visualizations`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 1: COMPARING TWO PROPORTIONS
  // ========================================
  {
    id: "two-proportions",
    tier: 1,
    title: "Two-Sample Proportion Test",
    description: "Compare proportions between two groups",
    icon: "🎯",
    category: "Basic Comparisons",
    autoFillExample: "I'm comparing response rates between a new treatment and standard care using a two-sample proportion test. I expect 30% response rate in the control group and 45% response rate in the treatment group (15 percentage point difference). I need 80% power with a two-sided test at alpha 0.05 to detect this difference. Please calculate how many patients I need per group and show me a power curve.",
    questions: [
      {
        id: "q1",
        label: "Research question",
        type: "textarea",
        placeholder: "e.g., Compare response rates between treatment and control",
        required: true
      },
      {
        id: "q2",
        label: "Expected proportion in group 1",
        type: "number",
        placeholder: "0.30",
        required: true,
        helpText: "Between 0 and 1 (e.g., 0.30 = 30%)",
        validation: { min: 0.01, max: 0.99, step: 0.01 }
      },
      {
        id: "q3",
        label: "Expected proportion in group 2",
        type: "number",
        placeholder: "0.45",
        required: true,
        helpText: "Between 0 and 1",
        validation: { min: 0.01, max: 0.99, step: 0.01 }
      },
      {
        id: "q4",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      },
      {
        id: "q5",
        label: "Test type",
        type: "radio",
        options: [
          { value: "two.sided", label: "Two-sided (default)" },
          { value: "one.sided", label: "One-sided" }
        ],
        required: true,
        helpText: "Two-sided tests for differences in either direction"
      }
    ],
    buildQuery: function(answers) {
      const diff = Math.abs(answers.q2 - answers.q3);
      return [
        `Research Question: ${answers.q1}`,
        ``,
        `Please perform a power analysis for comparing two proportions:`,
        `- Expected proportion in group 1: ${answers.q2} (${(answers.q2 * 100).toFixed(1)}%)`,
        `- Expected proportion in group 2: ${answers.q3} (${(answers.q3 * 100).toFixed(1)}%)`,
        `- Absolute difference: ${diff.toFixed(3)} (${(diff * 100).toFixed(1)} percentage points)`,
        `- Desired power: ${parseFloat(answers.q4) * 100}%`,
        `- Test type: ${answers.q5}`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required sample size per group`,
        `2. Create a power curve`,
        `3. Show sensitivity to different proportion values`,
        `4. Calculate odds ratio and risk ratio`,
        `5. Provide clinical interpretation`,
        `6. Export all results and visualizations`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 2: SURVIVAL ANALYSIS
  // ========================================
  {
    id: "survival-logrank",
    tier: 2,
    title: "Survival Analysis (Log-Rank Test)",
    description: "Sample size for comparing survival curves",
    icon: "⏱️",
    category: "Regression & Models",
    autoFillExample: "I'm planning a cancer trial comparing two treatments using a log-rank test for survival analysis. I expect a hazard ratio of 0.70 (30% reduction in hazard of death). The median survival in the control group is expected to be 2.5 years. We'll follow patients for 3 years total with a 2-year accrual period. I need 80% power with a two-sided test at alpha 0.05 to detect this difference. How many patients should we enroll?",
    questions: [
      {
        id: "q1",
        label: "Study description",
        type: "textarea",
        placeholder: "e.g., Compare overall survival between two treatments",
        required: true
      },
      {
        id: "q2",
        label: "Expected hazard ratio",
        type: "number",
        placeholder: "0.70",
        required: true,
        helpText: "HR < 1 favors experimental, HR > 1 favors control",
        validation: { min: 0.1, max: 10, step: 0.01 }
      },
      {
        id: "q3",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      },
      {
        id: "q4",
        label: "Follow-up duration (years)",
        type: "number",
        placeholder: "3",
        required: true,
        helpText: "Maximum follow-up time",
        validation: { min: 0.5, max: 20 }
      },
      {
        id: "q5",
        label: "Expected median survival in control (years)",
        type: "number",
        placeholder: "2.5",
        required: false,
        helpText: "Optional: helps estimate event rates",
        validation: { min: 0.1, max: 50 }
      },
      {
        id: "q6",
        label: "Accrual period (years)",
        type: "number",
        placeholder: "2",
        required: false,
        helpText: "Optional: time to enroll all subjects",
        validation: { min: 0.1, max: 10 }
      }
    ],
    buildQuery: function(answers) {
      const parts = [
        `Study: ${answers.q1}`,
        ``,
        `Please perform a sample size calculation for survival analysis (log-rank test):`,
        `- Expected hazard ratio: ${answers.q2}`,
        `- Desired power: ${parseFloat(answers.q3) * 100}%`,
        `- Follow-up duration: ${answers.q4} years`,
        `- Alpha: 0.05`
      ];

      if (answers.q5) {
        parts.push(`- Median survival in control: ${answers.q5} years`);
      }
      if (answers.q6) {
        parts.push(`- Accrual period: ${answers.q6} years`);
      }

      parts.push(``);
      parts.push(`Please use appropriate methods (Schoenfeld formula or similar):`);
      parts.push(`1. Calculate required number of events`);
      parts.push(`2. Calculate total sample size needed`);
      parts.push(`3. Create power curves for different hazard ratios`);
      parts.push(`4. Show sensitivity to event rates`);
      if (answers.q5 && answers.q6) {
        parts.push(`5. Account for staggered accrual and loss to follow-up`);
      }
      parts.push(`6. Provide interpretation and recommendations`);
      parts.push(`7. Export results and visualizations`);

      return parts.join('\n');
    }
  },

  // ========================================
  // TIER 2: LOGISTIC REGRESSION
  // ========================================
  {
    id: "logistic-regression",
    tier: 2,
    title: "Logistic Regression",
    description: "Sample size for binary outcome regression",
    icon: "📉",
    category: "Regression & Models",
    autoFillExample: "I want to predict disease occurrence (yes/no) using logistic regression based on age, BMI, and treatment group. My main predictor (treatment) has an expected odds ratio of 2.0. I have 3 predictors total in the model. The disease prevalence is about 30% in the population. I need 80% power with alpha 0.05 to detect the treatment effect. What total sample size do I need?",
    questions: [
      {
        id: "q1",
        label: "Research objective",
        type: "textarea",
        placeholder: "e.g., Predict disease risk based on age, BMI, and treatment",
        required: true
      },
      {
        id: "q2",
        label: "Expected odds ratio for main predictor",
        type: "number",
        placeholder: "2.0",
        required: true,
        helpText: "OR > 1 means increased odds, OR < 1 means decreased odds",
        validation: { min: 0.1, max: 10, step: 0.01 }
      },
      {
        id: "q3",
        label: "Number of predictors in the model",
        type: "number",
        placeholder: "3",
        required: true,
        helpText: "Total number of independent variables",
        validation: { min: 1, max: 20 }
      },
      {
        id: "q4",
        label: "Expected event rate (proportion with outcome)",
        type: "number",
        placeholder: "0.30",
        required: true,
        helpText: "Proportion of subjects with the outcome (0 to 1)",
        validation: { min: 0.05, max: 0.95, step: 0.01 }
      },
      {
        id: "q5",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Research Objective: ${answers.q1}`,
        ``,
        `Please perform sample size calculation for logistic regression:`,
        `- Expected odds ratio: ${answers.q2}`,
        `- Number of predictors: ${answers.q3}`,
        `- Expected event rate: ${answers.q4} (${(answers.q4 * 100).toFixed(1)}%)`,
        `- Desired power: ${parseFloat(answers.q5) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required total sample size`,
        `2. Apply rule of thumb: 10-15 events per predictor variable`,
        `3. Create power curves for different odds ratios`,
        `4. Show sensitivity to event rate assumptions`,
        `5. Provide guidance on model building and validation`,
        `6. Consider sample size for model validation (if applicable)`,
        `7. Export comprehensive results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 1: REPEATED MEASURES ANOVA
  // ========================================
  {
    id: "repeated-measures-anova",
    tier: 1,
    title: "Repeated Measures ANOVA",
    description: "Within-subjects comparisons over time",
    icon: "🔄",
    category: "Basic Comparisons",
    autoFillExample: "I'm measuring pain scores at 4 time points using repeated measures ANOVA: baseline, 1 week, 4 weeks, and 12 weeks after treatment. I expect a medium effect size (Cohen's f = 0.25) across time points, and the correlation between repeated measures is around 0.5. I need 80% power with alpha 0.05 to detect the time effect. How many subjects do I need?",
    questions: [
      {
        id: "q1",
        label: "Study description",
        type: "textarea",
        placeholder: "e.g., Measure pain scores at baseline, 1 week, 4 weeks, 12 weeks",
        required: true
      },
      {
        id: "q2",
        label: "Number of time points",
        type: "number",
        placeholder: "4",
        required: true,
        validation: { min: 2, max: 10 }
      },
      {
        id: "q3",
        label: "Effect size (Cohen's f)",
        type: "select",
        options: [
          { value: "0.10", label: "Small (0.10)" },
          { value: "0.25", label: "Medium (0.25)" },
          { value: "0.40", label: "Large (0.40)" }
        ],
        required: true
      },
      {
        id: "q4",
        label: "Expected correlation between time points",
        type: "number",
        placeholder: "0.5",
        required: true,
        helpText: "Correlation between repeated measures (typical: 0.3-0.7)",
        validation: { min: 0, max: 0.99, step: 0.05 }
      },
      {
        id: "q5",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Study: ${answers.q1}`,
        ``,
        `Please perform sample size calculation for **repeated measures ANOVA**:`,
        `- Number of time points: ${answers.q2}`,
        `- Effect size (Cohen's f): ${answers.q3}`,
        `- Correlation between measurements: ${answers.q4}`,
        `- Desired power: ${parseFloat(answers.q5) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required sample size`,
        `2. Explain the benefit of repeated measures (vs. between-subjects)`,
        `3. Show how correlation affects required sample size`,
        `4. Create power curves`,
        `5. Discuss sphericity assumptions`,
        `6. Provide guidance on handling missing data`,
        `7. Export results and visualizations`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 2: CORRELATION/REGRESSION COEFFICIENT
  // ========================================
  {
    id: "correlation",
    tier: 2,
    title: "Correlation Analysis",
    description: "Sample size for detecting correlations",
    icon: "🔗",
    category: "Regression & Models",
    autoFillExample: "I want to examine the correlation between exercise frequency (hours per week) and systolic blood pressure using Pearson correlation analysis. Based on literature, I expect a moderate negative correlation around r = -0.30. I need 80% power with a two-sided test at alpha 0.05 to detect this correlation. How many participants do I need?",
    questions: [
      {
        id: "q1",
        label: "Research question",
        type: "textarea",
        placeholder: "e.g., Correlation between exercise frequency and blood pressure",
        required: true
      },
      {
        id: "q2",
        label: "Expected correlation (r)",
        type: "number",
        placeholder: "0.30",
        required: true,
        helpText: "Pearson correlation coefficient (-1 to 1, typically 0.1 to 0.5)",
        validation: { min: -0.99, max: 0.99, step: 0.01 }
      },
      {
        id: "q3",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      },
      {
        id: "q4",
        label: "Test type",
        type: "radio",
        options: [
          { value: "two.sided", label: "Two-sided" },
          { value: "greater", label: "One-sided (positive correlation)" },
          { value: "less", label: "One-sided (negative correlation)" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Research Question: ${answers.q1}`,
        ``,
        `Please perform sample size calculation for correlation analysis:`,
        `- Expected correlation coefficient (r): ${answers.q2}`,
        `- Desired power: ${parseFloat(answers.q3) * 100}%`,
        `- Test type: ${answers.q4}`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required sample size`,
        `2. Convert r to R² (explained variance)`,
        `3. Create power curve for range of correlations`,
        `4. Show confidence interval width for different sample sizes`,
        `5. Discuss effect size interpretation (weak/moderate/strong)`,
        `6. Provide guidance on data quality and outliers`,
        `7. Export results and visualizations`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 2: NON-INFERIORITY / EQUIVALENCE
  // ========================================
  {
    id: "non-inferiority",
    tier: 2,
    title: "Non-Inferiority / Equivalence Test",
    description: "Show new treatment is not worse (or equivalent)",
    icon: "⚖️",
    category: "Regression & Models",
    autoFillExample: "I want to show that a new generic drug is non-inferior to the brand-name drug on a continuous outcome measure (e.g., blood pressure reduction in mmHg). The non-inferiority margin is 0.1 standard deviations on the outcome scale (SD = 1.0). I expect no true difference between treatments (mean difference = 0). I need 80% power with a one-sided test at alpha 0.05 to demonstrate non-inferiority. What sample size per group do I need?",
    questions: [
      {
        id: "q1",
        label: "Study objective",
        type: "textarea",
        placeholder: "e.g., Show new drug is non-inferior to standard treatment",
        required: true
      },
      {
        id: "q2",
        label: "Test type",
        type: "radio",
        options: [
          { value: "non-inferiority", label: "Non-inferiority (not worse than)" },
          { value: "equivalence", label: "Equivalence (similar to)" }
        ],
        required: true,
        helpText: "Non-inferiority: one-sided, Equivalence: two-sided"
      },
      {
        id: "q3",
        label: "Non-inferiority or equivalence margin",
        type: "number",
        placeholder: "0.1",
        required: true,
        helpText: "Maximum acceptable difference (in same units as outcome)",
        validation: { min: 0.01, max: 10, step: 0.01 }
      },
      {
        id: "q4",
        label: "Expected mean difference (or 0 for equivalence)",
        type: "number",
        placeholder: "0",
        required: true,
        helpText: "Expected difference between groups (often 0)",
        validation: { min: -10, max: 10, step: 0.01 }
      },
      {
        id: "q5",
        label: "Expected standard deviation",
        type: "number",
        placeholder: "1.0",
        required: true,
        helpText: "Pooled standard deviation",
        validation: { min: 0.01, max: 100, step: 0.01 }
      },
      {
        id: "q6",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Study Objective: ${answers.q1}`,
        ``,
        `Please perform sample size calculation for **${answers.q2} test**:`,
        `- Type: ${answers.q2}`,
        `- Margin: ${answers.q3}`,
        `- Expected difference: ${answers.q4}`,
        `- Standard deviation: ${answers.q5}`,
        `- Desired power: ${parseFloat(answers.q6) * 100}%`,
        `- Alpha: 0.05 (one-sided for non-inferiority, two-sided for equivalence)`,
        ``,
        `Please:`,
        `1. Calculate required sample size per group`,
        `2. Explain the ${answers.q2} hypothesis framework`,
        `3. Discuss how to choose the margin clinically`,
        `4. Create power curves for different margins`,
        `5. Show confidence interval interpretation`,
        `6. Provide guidance on analysis and reporting`,
        `7. Export comprehensive results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 3: CLUSTER RANDOMIZED TRIAL
  // ========================================
  {
    id: "cluster-rct",
    tier: 3,
    title: "Cluster Randomized Trial",
    description: "RCT where clusters (not individuals) are randomized",
    icon: "🏥",
    category: "Advanced Designs",
    autoFillExample: "I'm planning a cluster randomized trial to randomize 30 primary care clinics (15 per arm: intervention vs usual care) to test a diabetes management intervention. Each clinic has approximately 50 patients (1500 total patients, 750 per arm). The expected treatment effect on HbA1c is Cohen's d = 0.3 (mean difference = 0.45%, pooled SD = 1.5%), and the intraclass correlation from prior studies is ICC = 0.05 (5% of variance due to clinic clustering). The cluster sizes are roughly equal across clinics (range: 45-55 patients). I need 80% power with alpha 0.05 to detect the treatment effect. The design effect is 1 + (50-1)×0.05 = 3.45, requiring effective sample size inflation of 3.45×. With this design, the effective sample size is 1500/3.45 = 435 patients. Is this adequate for 80% power to detect d=0.3?",
    questions: [
      {
        id: "q1",
        label: "Study description",
        type: "textarea",
        placeholder: "e.g., Randomize 30 clinics to intervention vs. control",
        required: true
      },
      {
        id: "q2",
        label: "Expected effect size (Cohen's d or similar)",
        type: "number",
        placeholder: "0.3",
        required: true,
        validation: { min: 0.1, max: 2.0, step: 0.05 }
      },
      {
        id: "q3",
        label: "Number of clusters available",
        type: "number",
        placeholder: "30",
        required: true,
        helpText: "Total clusters across both arms",
        validation: { min: 4, max: 500 }
      },
      {
        id: "q4",
        label: "Average cluster size",
        type: "number",
        placeholder: "50",
        required: true,
        helpText: "Average individuals per cluster",
        validation: { min: 2, max: 10000 }
      },
      {
        id: "q5",
        label: "Intracluster correlation (ICC)",
        type: "number",
        placeholder: "0.05",
        required: true,
        helpText: "Similarity within clusters (typical: 0.01-0.20)",
        validation: { min: 0, max: 0.99, step: 0.01 }
      },
      {
        id: "q6",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      },
      {
        id: "q7",
        label: "Is cluster size variable?",
        type: "radio",
        options: [
          { value: "constant", label: "No, roughly equal" },
          { value: "variable", label: "Yes, varies by cluster" }
        ],
        required: true,
        helpText: "Variable cluster sizes reduce effective sample size"
      }
    ],
    buildQuery: function(answers) {
      return [
        `Study Design: ${answers.q1}`,
        ``,
        `Please perform sample size calculation for a **cluster randomized trial**:`,
        `- Expected effect size: ${answers.q2}`,
        `- Number of clusters: ${answers.q3}`,
        `- Average cluster size: ${answers.q4}`,
        `- Intracluster correlation (ICC): ${answers.q5}`,
        `- Desired power: ${parseFloat(answers.q6) * 100}%`,
        `- Cluster size variability: ${answers.q7}`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate design effect due to clustering`,
        `2. Determine if ${answers.q3} clusters with ${answers.q4} individuals each provides adequate power`,
        `3. Show trade-offs: more clusters vs. larger clusters`,
        `4. Create power curves varying clusters and cluster size`,
        `5. Discuss ICC estimation and sensitivity`,
        answers.q7 === 'variable' ? `6. Account for coefficient of variation in cluster sizes` : `6. Assume equal cluster sizes`,
        `7. Provide recommendations on design and analysis`,
        `8. Export comprehensive results and visualizations`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 1: CHI-SQUARE TEST
  // ========================================
  {
    id: "chi-square",
    tier: 1,
    title: "Chi-Square Test",
    description: "Test association between categorical variables",
    icon: "📊",
    category: "Basic Comparisons",
    autoFillExample: "I want to test if treatment response (yes/no) is associated with patient gender (male/female) using a chi-square test of independence. This is a 2x2 contingency table. I expect a medium effect size (Cohen's w = 0.30), which corresponds to a moderate association between gender and treatment response. I need 80% power with a two-sided test at alpha 0.05. What total sample size do I need?",
    questions: [
      {
        id: "q1",
        label: "Research question",
        type: "textarea",
        placeholder: "e.g., Is treatment response associated with gender?",
        required: true
      },
      {
        id: "q2",
        label: "Table dimensions",
        type: "select",
        options: [
          { value: "2x2", label: "2x2 table" },
          { value: "2x3", label: "2x3 table" },
          { value: "3x3", label: "3x3 table" },
          { value: "custom", label: "Custom dimensions" }
        ],
        required: true,
        helpText: "Rows × Columns"
      },
      {
        id: "q3",
        label: "Effect size (w)",
        type: "select",
        options: [
          { value: "0.10", label: "Small (0.10)" },
          { value: "0.30", label: "Medium (0.30)" },
          { value: "0.50", label: "Large (0.50)" }
        ],
        required: true,
        helpText: "Cohen's w for chi-square tests"
      },
      {
        id: "q4",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Research Question: ${answers.q1}`,
        ``,
        `Please perform sample size calculation for **chi-square test of independence**:`,
        `- Table dimensions: ${answers.q2}`,
        `- Effect size (Cohen's w): ${answers.q3}`,
        `- Desired power: ${parseFloat(answers.q4) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required total sample size`,
        `2. Calculate degrees of freedom`,
        `3. Explain effect size in terms of odds ratios (for 2x2 table)`,
        `4. Create power curve`,
        `5. Show expected cell counts (rule of thumb: ≥5 per cell)`,
        `6. Provide guidance on Fisher's exact test (for small samples)`,
        `7. Export results and recommendations`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 1: PAIRED T-TEST
  // ========================================
  {
    id: "paired-t-test",
    tier: 1,
    title: "Paired T-Test",
    description: "Compare means for matched pairs or repeated measurements",
    icon: "🔁",
    category: "Basic Comparisons",
    autoFillExample: "I want to compare blood pressure before and after a treatment intervention using a paired t-test. Each patient serves as their own control (paired design). Based on pilot data, I expect a mean reduction of 8 mmHg with a standard deviation of differences of 15 mmHg. The correlation between pre and post measurements is about 0.6. I need 80% power with a two-sided test at alpha 0.05 to detect this within-subject change. How many patients do I need to recruit?",
    questions: [
      {
        id: "q1",
        label: "Research question",
        type: "textarea",
        placeholder: "e.g., Compare blood pressure before vs. after treatment",
        required: true
      },
      {
        id: "q2",
        label: "Expected mean difference",
        type: "number",
        placeholder: "8",
        required: true,
        helpText: "Expected change from pre to post"
      },
      {
        id: "q3",
        label: "Standard deviation of differences",
        type: "number",
        placeholder: "15",
        required: true,
        helpText: "SD of within-subject changes"
      },
      {
        id: "q4",
        label: "Expected correlation (pre-post)",
        type: "number",
        placeholder: "0.6",
        required: false,
        helpText: "Optional: correlation between paired measurements (0-1)"
      },
      {
        id: "q5",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      const parts = [
        `Research Question: ${answers.q1}`,
        ``,
        `Please perform a **paired t-test** power analysis with:`,
        `- Expected mean difference: ${answers.q2}`,
        `- SD of differences: ${answers.q3}`
      ];
      if (answers.q4) {
        parts.push(`- Pre-post correlation: ${answers.q4}`);
      }
      parts.push(`- Desired power: ${parseFloat(answers.q5) * 100}%`);
      parts.push(`- Alpha: 0.05`);
      parts.push(``);
      parts.push(`Please:`);
      parts.push(`1. Calculate required sample size (number of pairs)`);
      parts.push(`2. Explain advantages of paired design over independent samples`);
      parts.push(`3. Show effect of correlation on required sample size`);
      parts.push(`4. Create power curve`);
      parts.push(`5. Provide guidance on handling missing pairs`);
      parts.push(`6. Export results`);
      return parts.join('\n');
    }
  },

  // ========================================
  // TIER 1: ONE-SAMPLE T-TEST
  // ========================================
  {
    id: "one-sample-t-test",
    tier: 1,
    title: "One-Sample T-Test",
    description: "Compare sample mean to a known population value",
    icon: "📍",
    category: "Basic Comparisons",
    autoFillExample: "I want to test if the average body temperature in my patient sample differs from the standard population mean of 98.6°F using a one-sample t-test. I expect my sample mean to be 98.2°F (a difference of 0.4°F from the population norm). Based on literature, the standard deviation is approximately 0.7°F. I need 80% power with a two-sided test at alpha 0.05 to detect this difference. How many patients do I need?",
    questions: [
      {
        id: "q1",
        label: "Research question",
        type: "textarea",
        placeholder: "e.g., Test if sample mean differs from population norm",
        required: true
      },
      {
        id: "q2",
        label: "Population mean (null hypothesis value)",
        type: "number",
        placeholder: "98.6",
        required: true
      },
      {
        id: "q3",
        label: "Expected sample mean",
        type: "number",
        placeholder: "98.2",
        required: true
      },
      {
        id: "q4",
        label: "Expected standard deviation",
        type: "number",
        placeholder: "0.7",
        required: true
      },
      {
        id: "q5",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      const diff = Math.abs(answers.q3 - answers.q2);
      return [
        `Research Question: ${answers.q1}`,
        ``,
        `Please perform a **one-sample t-test** power analysis with:`,
        `- Null hypothesis (population mean): ${answers.q2}`,
        `- Expected sample mean: ${answers.q3}`,
        `- Absolute difference: ${diff.toFixed(3)}`,
        `- Expected SD: ${answers.q4}`,
        `- Effect size (Cohen's d): ${(diff / answers.q4).toFixed(3)}`,
        `- Desired power: ${parseFloat(answers.q5) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required sample size`,
        `2. Create power curve`,
        `3. Show confidence interval width`,
        `4. Discuss assumptions and normality`,
        `5. Export results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 1: ONE-SAMPLE PROPORTION TEST
  // ========================================
  {
    id: "one-proportion",
    tier: 1,
    title: "One-Sample Proportion Test",
    description: "Compare observed proportion to a known value",
    icon: "🎲",
    category: "Basic Comparisons",
    autoFillExample: "I want to test if the response rate in my clinic differs from the national average response rate of 60% using a one-sample proportion test. I expect my clinic's response rate to be 70% (10 percentage points higher than the national average). I need 80% power with a two-sided test at alpha 0.05 to detect this difference. How many patients do I need to sample?",
    questions: [
      {
        id: "q1",
        label: "Research question",
        type: "textarea",
        placeholder: "e.g., Test if clinic response rate differs from national average",
        required: true
      },
      {
        id: "q2",
        label: "Null hypothesis proportion",
        type: "number",
        placeholder: "0.60",
        required: true,
        helpText: "Population/reference proportion (0 to 1)"
      },
      {
        id: "q3",
        label: "Expected sample proportion",
        type: "number",
        placeholder: "0.70",
        required: true,
        helpText: "Proportion you expect in your sample"
      },
      {
        id: "q4",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      const diff = Math.abs(answers.q3 - answers.q2);
      return [
        `Research Question: ${answers.q1}`,
        ``,
        `Please perform a **one-sample proportion test** power analysis:`,
        `- Null hypothesis proportion: ${answers.q2} (${(answers.q2 * 100).toFixed(1)}%)`,
        `- Expected sample proportion: ${answers.q3} (${(answers.q3 * 100).toFixed(1)}%)`,
        `- Absolute difference: ${diff.toFixed(3)} (${(diff * 100).toFixed(1)} percentage points)`,
        `- Desired power: ${parseFloat(answers.q4) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required sample size`,
        `2. Create power curve`,
        `3. Show confidence interval for the proportion`,
        `4. Discuss continuity correction if applicable`,
        `5. Export results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 1: MCNEMAR'S TEST
  // ========================================
  {
    id: "mcnemar-test",
    tier: 1,
    title: "McNemar's Test",
    description: "Compare paired proportions (before-after, matched pairs)",
    icon: "↔️",
    category: "Basic Comparisons",
    autoFillExample: "I'm conducting a before-after study to test if a training program changes physicians' prescribing practices (yes/no). This is a paired design where each physician is measured before and after training using McNemar's test. I expect 40% of physicians will change from non-compliant to compliant, while 10% will change from compliant to non-compliant (discordant pairs). I need 80% power with alpha 0.05 to detect this change. How many physicians do I need?",
    questions: [
      {
        id: "q1",
        label: "Study description",
        type: "textarea",
        placeholder: "e.g., Before-after study of prescribing practices",
        required: true
      },
      {
        id: "q2",
        label: "Expected proportion changing from No to Yes",
        type: "number",
        placeholder: "0.40",
        required: true,
        helpText: "Proportion of discordant pairs (0 to 1)"
      },
      {
        id: "q3",
        label: "Expected proportion changing from Yes to No",
        type: "number",
        placeholder: "0.10",
        required: true,
        helpText: "Proportion of opposite discordant pairs"
      },
      {
        id: "q4",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Study: ${answers.q1}`,
        ``,
        `Please perform **McNemar's test** power analysis:`,
        `- Proportion changing from No→Yes: ${answers.q2} (${(answers.q2 * 100).toFixed(1)}%)`,
        `- Proportion changing from Yes→No: ${answers.q3} (${(answers.q3 * 100).toFixed(1)}%)`,
        `- Odds ratio: ${(answers.q2 / answers.q3).toFixed(2)}`,
        `- Desired power: ${parseFloat(answers.q4) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required number of matched pairs`,
        `2. Explain discordant vs. concordant pairs`,
        `3. Show 2×2 contingency table structure`,
        `4. Create power curve`,
        `5. Discuss exact vs. chi-square approximation`,
        `6. Export results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 1: WILCOXON-MANN-WHITNEY TEST
  // ========================================
  {
    id: "wilcoxon-mann-whitney",
    tier: 1,
    title: "Mann-Whitney U Test (Wilcoxon Rank-Sum)",
    description: "Nonparametric test for two independent groups",
    icon: "📊",
    category: "Basic Comparisons",
    autoFillExample: "I want to compare pain scores between two treatment groups using the Mann-Whitney U test (Wilcoxon rank-sum test), since the data may not be normally distributed. I expect a medium effect size (probability that treatment group score > control group score is 0.65, where 0.5 = no effect). I need 80% power with a two-sided test at alpha 0.05. How many patients do I need per group?",
    questions: [
      {
        id: "q1",
        label: "Research question",
        type: "textarea",
        placeholder: "e.g., Compare pain scores between two treatments (nonparametric)",
        required: true
      },
      {
        id: "q2",
        label: "Effect size (probability of superiority)",
        type: "number",
        placeholder: "0.65",
        required: true,
        helpText: "P(X > Y) where 0.5 = no effect, >0.5 favors group X"
      },
      {
        id: "q3",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Research Question: ${answers.q1}`,
        ``,
        `Please perform power analysis for **Mann-Whitney U test (Wilcoxon rank-sum)**:`,
        `- Effect size (probability of superiority): ${answers.q2}`,
        `- Desired power: ${parseFloat(answers.q3) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required sample size per group`,
        `2. Convert effect size to equivalent Cohen's d for comparison`,
        `3. Explain relative efficiency vs. t-test`,
        `4. Create power curve`,
        `5. Discuss when to use vs. parametric t-test`,
        `6. Export results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 2: MULTIPLE LINEAR REGRESSION
  // ========================================
  {
    id: "multiple-regression",
    tier: 2,
    title: "Multiple Linear Regression",
    description: "Sample size for continuous outcome regression",
    icon: "📉",
    category: "Regression & Models",
    autoFillExample: "I want to predict blood pressure (continuous outcome) using multiple linear regression with 5 predictors: age, BMI, exercise frequency, sodium intake, and treatment group. My main predictor of interest (treatment) is expected to have an R² increase of 0.08 (8% additional variance explained) beyond the other 4 predictors. I need 80% power with alpha 0.05 to detect this effect. What total sample size do I need?",
    questions: [
      {
        id: "q1",
        label: "Research objective",
        type: "textarea",
        placeholder: "e.g., Predict blood pressure using age, BMI, exercise, sodium, treatment",
        required: true
      },
      {
        id: "q2",
        label: "Total number of predictors",
        type: "number",
        placeholder: "5",
        required: true,
        helpText: "All independent variables in the model"
      },
      {
        id: "q3",
        label: "Expected R² increase for predictor of interest",
        type: "number",
        placeholder: "0.08",
        required: true,
        helpText: "Additional variance explained by your main predictor"
      },
      {
        id: "q4",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      const f2 = answers.q3 / (1 - answers.q3);
      return [
        `Research Objective: ${answers.q1}`,
        ``,
        `Please perform sample size calculation for **multiple linear regression**:`,
        `- Total predictors: ${answers.q2}`,
        `- Expected R² increase: ${answers.q3} (${(answers.q3 * 100).toFixed(1)}%)`,
        `- Cohen's f²: ${f2.toFixed(3)}`,
        `- Desired power: ${parseFloat(answers.q4) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required total sample size`,
        `2. Apply rule of thumb: 15-20 cases per predictor`,
        `3. Test hierarchical regression (R² change)`,
        `4. Create power curves for different R² values`,
        `5. Discuss multicollinearity concerns`,
        `6. Provide guidance on model validation`,
        `7. Export comprehensive results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 2: TWO-WAY ANOVA
  // ========================================
  {
    id: "two-way-anova",
    tier: 2,
    title: "Two-Way ANOVA",
    description: "Factorial design with two independent factors",
    icon: "📊",
    category: "Regression & Models",
    autoFillExample: "I'm conducting a 3×2 factorial design two-way ANOVA with Treatment (3 levels: placebo, low-dose, high-dose) and Gender (2 levels: male, female). I expect a medium main effect for Treatment (Cohen's f = 0.25), a small main effect for Gender (f = 0.15), and a small interaction effect (f = 0.15). I need 80% power with alpha 0.05 to detect the treatment main effect. How many participants do I need per cell?",
    questions: [
      {
        id: "q1",
        label: "Study description",
        type: "textarea",
        placeholder: "e.g., 3×2 factorial: Treatment (3 levels) × Gender (2 levels)",
        required: true
      },
      {
        id: "q2",
        label: "Factor A: Number of levels",
        type: "number",
        placeholder: "3",
        required: true,
        helpText: "Levels of first factor"
      },
      {
        id: "q3",
        label: "Factor B: Number of levels",
        type: "number",
        placeholder: "2",
        required: true,
        helpText: "Levels of second factor"
      },
      {
        id: "q4",
        label: "Expected effect size for main effect A (Cohen's f)",
        type: "number",
        placeholder: "0.25",
        required: true
      },
      {
        id: "q5",
        label: "Expected effect size for main effect B (Cohen's f)",
        type: "number",
        placeholder: "0.15",
        required: false,
        helpText: "Optional"
      },
      {
        id: "q6",
        label: "Expected interaction effect size (Cohen's f)",
        type: "number",
        placeholder: "0.15",
        required: false,
        helpText: "Optional"
      },
      {
        id: "q7",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      const parts = [
        `Study: ${answers.q1}`,
        ``,
        `Please perform power analysis for **two-way ANOVA**:`,
        `- Factor A levels: ${answers.q2}`,
        `- Factor B levels: ${answers.q3}`,
        `- Total cells: ${answers.q2 * answers.q3}`,
        `- Main effect A (Cohen's f): ${answers.q4}`
      ];
      if (answers.q5) parts.push(`- Main effect B (Cohen's f): ${answers.q5}`);
      if (answers.q6) parts.push(`- Interaction effect (Cohen's f): ${answers.q6}`);
      parts.push(`- Desired power: ${parseFloat(answers.q7) * 100}%`);
      parts.push(`- Alpha: 0.05`);
      parts.push(``);
      parts.push(`Please:`);
      parts.push(`1. Calculate required sample size per cell`);
      parts.push(`2. Calculate total sample size`);
      parts.push(`3. Power analysis for each effect (main effects and interaction)`);
      parts.push(`4. Create power curves`);
      parts.push(`5. Discuss balanced vs. unbalanced designs`);
      parts.push(`6. Provide guidance on simple effects analysis`);
      parts.push(`7. Export results`);
      return parts.join('\n');
    }
  },

  // ========================================
  // TIER 2: ANCOVA
  // ========================================
  {
    id: "ancova",
    tier: 2,
    title: "ANCOVA (Analysis of Covariance)",
    description: "Compare groups while controlling for covariates",
    icon: "📐",
    category: "Regression & Models",
    autoFillExample: "I'm comparing post-treatment depression scores across 3 treatment groups using ANCOVA, controlling for baseline depression score as a covariate. The correlation between baseline and post-treatment scores is expected to be 0.60. I expect a medium effect size (Cohen's f = 0.25) for the treatment effect. I need 80% power with alpha 0.05 to detect the treatment effect. How many participants do I need per group?",
    questions: [
      {
        id: "q1",
        label: "Study description",
        type: "textarea",
        placeholder: "e.g., Compare 3 treatments on post-scores, controlling for baseline",
        required: true
      },
      {
        id: "q2",
        label: "Number of groups",
        type: "number",
        placeholder: "3",
        required: true
      },
      {
        id: "q3",
        label: "Number of covariates",
        type: "number",
        placeholder: "1",
        required: true,
        helpText: "How many control variables?"
      },
      {
        id: "q4",
        label: "Expected correlation between covariate and outcome",
        type: "number",
        placeholder: "0.60",
        required: true,
        helpText: "Correlation (0 to 1) - higher = more power gain"
      },
      {
        id: "q5",
        label: "Effect size for group comparison (Cohen's f)",
        type: "number",
        placeholder: "0.25",
        required: true
      },
      {
        id: "q6",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Study: ${answers.q1}`,
        ``,
        `Please perform power analysis for **ANCOVA**:`,
        `- Number of groups: ${answers.q2}`,
        `- Number of covariates: ${answers.q3}`,
        `- Correlation (covariate-outcome): ${answers.q4}`,
        `- Effect size (Cohen's f): ${answers.q5}`,
        `- Desired power: ${parseFloat(answers.q6) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required sample size per group`,
        `2. Show power gain from including covariate`,
        `3. Compare sample size to ANOVA without covariate`,
        `4. Create power curve`,
        `5. Discuss assumptions (homogeneity of regression slopes)`,
        `6. Provide guidance on covariate selection`,
        `7. Export results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 2: COX PROPORTIONAL HAZARDS REGRESSION
  // ========================================
  {
    id: "cox-regression",
    tier: 2,
    title: "Cox Proportional Hazards Regression",
    description: "Sample size for time-to-event regression",
    icon: "⏱️",
    category: "Regression & Models",
    autoFillExample: "I'm planning a survival analysis using Cox proportional hazards regression to predict time to death. My main predictor is treatment group (expected hazard ratio = 0.70). I will include 3 additional covariates (age, stage, comorbidities) in the model. I expect an event rate of 60% over the follow-up period. I need 80% power with alpha 0.05 to detect the treatment effect. How many patients do I need?",
    questions: [
      {
        id: "q1",
        label: "Study objective",
        type: "textarea",
        placeholder: "e.g., Predict survival time using treatment, age, stage, comorbidities",
        required: true
      },
      {
        id: "q2",
        label: "Expected hazard ratio for main predictor",
        type: "number",
        placeholder: "0.70",
        required: true,
        helpText: "HR < 1 = reduced hazard, HR > 1 = increased hazard"
      },
      {
        id: "q3",
        label: "Total number of predictors in model",
        type: "number",
        placeholder: "4",
        required: true
      },
      {
        id: "q4",
        label: "Expected event rate (proportion with event)",
        type: "number",
        placeholder: "0.60",
        required: true,
        helpText: "Proportion experiencing the event (0 to 1)"
      },
      {
        id: "q5",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Study Objective: ${answers.q1}`,
        ``,
        `Please perform sample size calculation for **Cox proportional hazards regression**:`,
        `- Expected hazard ratio: ${answers.q2}`,
        `- Total predictors: ${answers.q3}`,
        `- Expected event rate: ${answers.q4} (${(answers.q4 * 100).toFixed(1)}%)`,
        `- Desired power: ${parseFloat(answers.q5) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required number of events`,
        `2. Calculate required total sample size`,
        `3. Apply rule of thumb: 10-15 events per predictor`,
        `4. Create power curves for different hazard ratios`,
        `5. Discuss proportional hazards assumption`,
        `6. Consider censoring patterns`,
        `7. Export comprehensive results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 2: POISSON REGRESSION
  // ========================================
  {
    id: "poisson-regression",
    tier: 2,
    title: "Poisson Regression",
    description: "Sample size for count outcome regression",
    icon: "🔢",
    category: "Regression & Models",
    autoFillExample: "I want to model the number of hospital readmissions (count outcome) using Poisson regression. My main predictor is an intervention program (expected rate ratio = 0.75, meaning 25% reduction in readmissions). The baseline mean count is 3.5 readmissions per patient. I have 2 additional covariates in the model. I need 80% power with alpha 0.05 to detect this effect. What sample size do I need?",
    questions: [
      {
        id: "q1",
        label: "Research objective",
        type: "textarea",
        placeholder: "e.g., Model hospital readmissions using intervention, age, comorbidity",
        required: true
      },
      {
        id: "q2",
        label: "Expected rate ratio (or incidence rate ratio)",
        type: "number",
        placeholder: "0.75",
        required: true,
        helpText: "RR < 1 = decreased rate, RR > 1 = increased rate"
      },
      {
        id: "q3",
        label: "Baseline mean count",
        type: "number",
        placeholder: "3.5",
        required: true,
        helpText: "Expected mean count in reference group"
      },
      {
        id: "q4",
        label: "Total number of predictors",
        type: "number",
        placeholder: "3",
        required: true
      },
      {
        id: "q5",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Research Objective: ${answers.q1}`,
        ``,
        `Please perform sample size calculation for **Poisson regression**:`,
        `- Expected rate ratio: ${answers.q2}`,
        `- Baseline mean count: ${answers.q3}`,
        `- Total predictors: ${answers.q4}`,
        `- Desired power: ${parseFloat(answers.q5) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required sample size`,
        `2. Discuss overdispersion and quasi-Poisson`,
        `3. Consider zero-inflation if applicable`,
        `4. Create power curves for different rate ratios`,
        `5. Compare to negative binomial if overdispersed`,
        `6. Provide interpretation guidelines`,
        `7. Export results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 2: GEE (GENERALIZED ESTIMATING EQUATIONS)
  // ========================================
  {
    id: "gee-model",
    tier: 2,
    title: "Generalized Estimating Equations (GEE)",
    description: "Longitudinal/clustered data with population-averaged effects",
    icon: "🔗",
    category: "Regression & Models",
    autoFillExample: "I'm analyzing repeated measures data (4 time points) using GEE with an exchangeable correlation structure. I'm comparing two treatment groups on a binary outcome (response yes/no). The expected odds ratio is 2.0, baseline response rate is 40%, and the within-subject correlation is 0.3. I need 80% power with alpha 0.05 to detect the treatment effect. How many subjects do I need?",
    questions: [
      {
        id: "q1",
        label: "Study description",
        type: "textarea",
        placeholder: "e.g., Repeated measures (4 time points), binary outcome, 2 groups",
        required: true
      },
      {
        id: "q2",
        label: "Number of repeated measurements per subject",
        type: "number",
        placeholder: "4",
        required: true
      },
      {
        id: "q3",
        label: "Expected effect size (OR for binary, or RR for count)",
        type: "number",
        placeholder: "2.0",
        required: true
      },
      {
        id: "q4",
        label: "Within-subject correlation",
        type: "number",
        placeholder: "0.3",
        required: true,
        helpText: "Correlation between repeated measures (0 to 1)"
      },
      {
        id: "q5",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Study: ${answers.q1}`,
        ``,
        `Please perform power analysis for **GEE model**:`,
        `- Repeated measurements: ${answers.q2}`,
        `- Expected effect size: ${answers.q3}`,
        `- Within-subject correlation: ${answers.q4}`,
        `- Desired power: ${parseFloat(answers.q5) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required number of subjects`,
        `2. Explain correlation structure (exchangeable, AR-1, etc.)`,
        `3. Show efficiency gain from repeated measures`,
        `4. Create power curves`,
        `5. Discuss missing data patterns`,
        `6. Compare GEE vs. mixed models`,
        `7. Export results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 3: CROSSOVER DESIGN
  // ========================================
  {
    id: "crossover-design",
    tier: 3,
    title: "Crossover Design",
    description: "Within-subject comparison of treatments",
    icon: "🔄",
    category: "Advanced Designs",
    autoFillExample: "I'm planning a 2×2 crossover trial for chronic pain management where each patient receives both Treatment A (new NSAID) and Treatment B (standard NSAID) in random order with a 2-week washout period between treatments. I expect a mean treatment difference of 6 units on a 0-100 VAS pain scale (Treatment A mean=32, Treatment B mean=38) with a within-subject standard deviation of 10 units and between-subject standard deviation of 12 units. The correlation between periods is expected to be ρ = 0.5 (50% of variance is between-subject). I need 80% power with alpha 0.05 to detect this crossover treatment effect (Cohen's d = 0.6). The efficiency gain from crossover vs parallel design is approximately 2.0× (requiring 50% of the parallel sample size). With this correlation, I estimate needing n ≈ 23 patients total to achieve 80% power. How many patients do I actually need?",
    questions: [
      {
        id: "q1",
        label: "Study description",
        type: "textarea",
        placeholder: "e.g., 2×2 crossover with Treatment A vs. B, washout period",
        required: true
      },
      {
        id: "q2",
        label: "Expected mean treatment difference",
        type: "number",
        placeholder: "6",
        required: true
      },
      {
        id: "q3",
        label: "Within-subject standard deviation",
        type: "number",
        placeholder: "10",
        required: true
      },
      {
        id: "q4",
        label: "Expected correlation between periods",
        type: "number",
        placeholder: "0.5",
        required: true,
        helpText: "Correlation (0 to 1)"
      },
      {
        id: "q5",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      },
      {
        id: "q6",
        label: "Expected carryover effect?",
        type: "radio",
        options: [
          { value: "none", label: "No carryover expected" },
          { value: "possible", label: "Possible carryover effect" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Study: ${answers.q1}`,
        ``,
        `Please perform power analysis for **crossover design**:`,
        `- Expected treatment difference: ${answers.q2}`,
        `- Within-subject SD: ${answers.q3}`,
        `- Period correlation: ${answers.q4}`,
        `- Carryover: ${answers.q6}`,
        `- Desired power: ${parseFloat(answers.q5) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate required number of subjects`,
        `2. Explain efficiency vs. parallel design`,
        `3. Discuss washout period importance`,
        `4. Test for period and carryover effects`,
        answers.q6 === 'possible' ? `5. Analyze potential carryover contamination` : `5. Verify assumptions`,
        `6. Create power curves`,
        `7. Export comprehensive results`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 3: FACTORIAL DESIGN (2×2 AND HIGHER)
  // ========================================
  {
    id: "factorial-design",
    tier: 3,
    title: "Factorial Design (2×2 or Higher)",
    description: "Test multiple interventions simultaneously",
    icon: "🎲",
    category: "Advanced Designs",
    autoFillExample: "I'm planning a 2×2 factorial trial testing two independent interventions for weight loss: Drug A - GLP-1 agonist (yes/no) and Drug B - behavioral counseling (yes/no), creating 4 treatment combinations (Control, Drug A only, Drug B only, Both). Each cell will have n participants. I expect a medium main effect for Drug A (Cohen's d = 0.50, mean weight loss = 5 kg, SD=10 kg), a small main effect for Drug B (d = 0.30, mean weight loss = 3 kg, SD=10 kg), and no significant interaction (d = 0.10, synergistic effect = 1 kg). I need 80% power with alpha 0.05 (two-sided) to detect both main effects. For d=0.50, I need n ≈ 64 per cell (256 total). For d=0.30, I need n ≈ 175 per cell (700 total). The factorial design efficiency allows testing both interventions with the sample size needed for the smaller effect. How many participants do I actually need per cell?",
    questions: [
      {
        id: "q1",
        label: "Factorial design description",
        type: "textarea",
        placeholder: "e.g., 2×2 factorial: Drug A (yes/no) × Drug B (yes/no)",
        required: true
      },
      {
        id: "q2",
        label: "First factor: Number of levels",
        type: "number",
        placeholder: "2",
        required: true
      },
      {
        id: "q3",
        label: "Second factor: Number of levels",
        type: "number",
        placeholder: "2",
        required: true
      },
      {
        id: "q4",
        label: "Expected main effect for Factor 1 (Cohen's d)",
        type: "number",
        placeholder: "0.50",
        required: true
      },
      {
        id: "q5",
        label: "Expected main effect for Factor 2 (Cohen's d)",
        type: "number",
        placeholder: "0.30",
        required: true
      },
      {
        id: "q6",
        label: "Expected interaction effect (Cohen's d)",
        type: "number",
        placeholder: "0",
        required: false,
        helpText: "Optional: 0 = no interaction"
      },
      {
        id: "q7",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      const parts = [
        `Study: ${answers.q1}`,
        ``,
        `Please perform power analysis for **factorial design**:`,
        `- Factor 1 levels: ${answers.q2}`,
        `- Factor 2 levels: ${answers.q3}`,
        `- Total cells: ${answers.q2 * answers.q3}`,
        `- Main effect 1 (Cohen's d): ${answers.q4}`,
        `- Main effect 2 (Cohen's d): ${answers.q5}`
      ];
      if (answers.q6 !== undefined) {
        parts.push(`- Interaction effect (Cohen's d): ${answers.q6}`);
      }
      parts.push(`- Desired power: ${parseFloat(answers.q7) * 100}%`);
      parts.push(`- Alpha: 0.05`);
      parts.push(``);
      parts.push(`Please:`);
      parts.push(`1. Calculate sample size per cell for each main effect`);
      parts.push(`2. Calculate total sample size needed`);
      parts.push(`3. Power analysis for interaction (if specified)`);
      parts.push(`4. Discuss efficiency of factorial designs`);
      parts.push(`5. Create power curves for each effect`);
      parts.push(`6. Provide interpretation guidelines`);
      parts.push(`7. Export results`);
      return parts.join('\n');
    }
  },

  // ========================================
  // TIER 3: META-ANALYSIS POWER
  // ========================================
  {
    id: "meta-analysis",
    tier: 3,
    title: "Meta-Analysis Power",
    description: "Sample size for detecting effects in meta-analysis",
    icon: "📚",
    category: "Advanced Designs",
    autoFillExample: "I'm planning a meta-analysis of RCTs testing cognitive behavioral therapy (CBT) for depression to pool results from multiple studies. I expect to find k = 15 eligible RCTs with an average sample size of 80 participants per study (total N = 1200 participants across all studies, n = 40 per arm). The expected pooled effect size is Cohen's d = 0.40 (moderate effect, CBT mean improvement = 4 points, Control mean = 0, pooled SD = 10 on BDI-II scale) with moderate heterogeneity (I² = 40%, τ² = 0.04, between-study SD = 0.20). I need 80% power with alpha 0.05 (two-sided) to detect this pooled effect using a random-effects model. With d = 0.40 and I² = 40%, power is approximately 85% with k = 15 studies. With I² = 0% (no heterogeneity), only k ≈ 8 studies would be needed. Is this number of studies sufficient, or should I aim for more studies?",
    questions: [
      {
        id: "q1",
        label: "Meta-analysis objective",
        type: "textarea",
        placeholder: "e.g., Pool results from RCTs testing intervention effect on outcome",
        required: true
      },
      {
        id: "q2",
        label: "Expected number of studies",
        type: "number",
        placeholder: "15",
        required: true
      },
      {
        id: "q3",
        label: "Average sample size per study",
        type: "number",
        placeholder: "80",
        required: true
      },
      {
        id: "q4",
        label: "Expected pooled effect size (Cohen's d or OR)",
        type: "number",
        placeholder: "0.40",
        required: true
      },
      {
        id: "q5",
        label: "Expected heterogeneity (I² as proportion)",
        type: "number",
        placeholder: "0.40",
        required: true,
        helpText: "I² between 0 and 1 (e.g., 0.40 = 40% heterogeneity)"
      },
      {
        id: "q6",
        label: "Desired power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Meta-Analysis Objective: ${answers.q1}`,
        ``,
        `Please perform power analysis for **meta-analysis**:`,
        `- Expected number of studies: ${answers.q2}`,
        `- Average sample size per study: ${answers.q3}`,
        `- Expected pooled effect size: ${answers.q4}`,
        `- Expected heterogeneity (I²): ${(answers.q5 * 100).toFixed(0)}%`,
        `- Desired power: ${parseFloat(answers.q6) * 100}%`,
        `- Alpha: 0.05`,
        ``,
        `Please:`,
        `1. Calculate power given current number of studies`,
        `2. Determine minimum number of studies needed`,
        `3. Account for heterogeneity in power calculation`,
        `4. Create power curve varying number of studies`,
        `5. Discuss fixed-effect vs. random-effects models`,
        `6. Consider publication bias impact`,
        `7. Export results and recommendations`
      ].join('\n');
    }
  },

  // ========================================
  // TIER 3: SAMPLE SIZE RE-ESTIMATION
  // ========================================
  {
    id: "sample-size-reestimation",
    tier: 3,
    title: "Sample Size Re-estimation",
    description: "Adaptive design with blinded interim analysis",
    icon: "🔄",
    category: "Advanced Designs",
    autoFillExample: "I'm planning an adaptive RCT for a novel diabetes drug with blinded sample size re-estimation at 50% information fraction (interim analysis after enrolling 200 of initially planned 400 participants, n=100 per arm at interim). Initial planning assumes treatment effect Cohen's d = 0.50 (HbA1c reduction: Drug mean = -1.0%, Placebo mean = -0.5%, pooled SD = 1.0%), but I want to re-estimate based on observed pooled variance at interim without unblinding treatment assignments. The initial sample size is 200 per group (400 total, based on d=0.50, 80% power, alpha=0.05). At interim, if observed variance is higher than assumed (SD = 1.2 instead of 1.0), I may need to increase to 288 per group (576 total, 1.44× inflation). I need 80% power overall with strict alpha protection at 0.05 (no alpha inflation). Maximum allowed sample size is 2× initial (800 total, 400 per group). Conditional power threshold for sample size increase is <80% at interim. How should I design this adaptive procedure with proper alpha control?",
    questions: [
      {
        id: "q1",
        label: "Study description",
        type: "textarea",
        placeholder: "e.g., RCT with blinded interim re-estimation at 50% enrollment",
        required: true
      },
      {
        id: "q2",
        label: "Initial planned sample size per group",
        type: "number",
        placeholder: "200",
        required: true
      },
      {
        id: "q3",
        label: "Information fraction at interim (%)",
        type: "number",
        placeholder: "50",
        required: true,
        helpText: "Percentage of planned sample at interim (typically 25-75%)"
      },
      {
        id: "q4",
        label: "Initial effect size assumption (Cohen's d)",
        type: "number",
        placeholder: "0.50",
        required: true
      },
      {
        id: "q5",
        label: "Desired final power",
        type: "select",
        options: [
          { value: "0.80", label: "80%" },
          { value: "0.90", label: "90%" }
        ],
        required: true
      },
      {
        id: "q6",
        label: "Maximum allowed sample size increase",
        type: "select",
        options: [
          { value: "1.5", label: "50% increase (1.5×)" },
          { value: "2.0", label: "100% increase (2×)" },
          { value: "3.0", label: "200% increase (3×)" }
        ],
        required: true,
        helpText: "Cap on total sample size"
      }
    ],
    buildQuery: function(answers) {
      return [
        `Study: ${answers.q1}`,
        ``,
        `Please design **sample size re-estimation** procedure:`,
        `- Initial sample size per group: ${answers.q2}`,
        `- Interim analysis at: ${answers.q3}% information`,
        `- Initial effect size: ${answers.q4}`,
        `- Target final power: ${parseFloat(answers.q5) * 100}%`,
        `- Maximum sample size multiplier: ${answers.q6}×`,
        `- Alpha: 0.05 (protected)`,
        ``,
        `Please:`,
        `1. Design blinded re-estimation procedure`,
        `2. Calculate conditional power at interim`,
        `3. Determine sample size adjustment rules`,
        `4. Ensure Type I error protection`,
        `5. Simulate operating characteristics`,
        `6. Create decision rules for continuation/expansion`,
        `7. Provide implementation guidelines`,
        `8. Export comprehensive adaptive design protocol`
      ].join('\n');
    }
  },

  // ================================================================================
  // TIER 4: PREDICTION MODELS (Riley's Methodology)
  // ================================================================================

  // Template 28: Binary Outcome Prediction Model
  {
    id: "prediction-binary",
    tier: 4,
    title: "Binary Outcome Prediction Model (Riley's Method)",
    description: "Sample size for developing clinical prediction models with binary outcomes (disease yes/no) using Riley et al. (2019) BMJ criteria",
    icon: "🎯",
    category: "Prediction Models",
    autoFillExample: "I'm developing a clinical prediction model to predict the risk of hospital readmission within 30 days (yes/no outcome). Based on literature review, similar models achieve a C-statistic of about 0.72, which corresponds to a Cox-Snell R² of approximately 0.15. I'm planning to include 15 candidate predictors (age, comorbidities, medications, lab values). The readmission rate in our population is about 18%. I want to use Riley's criteria with shrinkage factor ≥ 0.9 to minimize overfitting. Please calculate the required sample size using the pmsampsize package and explain each of the 4 Riley criteria (precise intercept, small MAPE, adequate shrinkage, low R² optimism). Also convert the final sample size to Events Per Predictor (EPP) and compare to the outdated '10 EPV rule'.",
    questions: [
      {
        id: "q1",
        label: "Clinical prediction question",
        type: "textarea",
        placeholder: "e.g., Predict risk of hospital readmission within 30 days",
        required: true,
        helpText: "Describe the outcome you're predicting"
      },
      {
        id: "q2",
        label: "Outcome prevalence (proportion)",
        type: "number",
        placeholder: "0.18",
        required: true,
        helpText: "Expected proportion with the outcome (e.g., 0.18 = 18%)"
      },
      {
        id: "q3",
        label: "Number of candidate predictors",
        type: "number",
        placeholder: "15",
        required: true,
        helpText: "Total predictor parameters in the model"
      },
      {
        id: "q4",
        label: "Expected model performance",
        type: "select",
        options: [
          { value: "cstat", label: "C-statistic (AUC)" },
          { value: "csrsq", label: "Cox-Snell R²" }
        ],
        required: true,
        helpText: "Choose which performance metric you have"
      },
      {
        id: "q5",
        label: "Performance value",
        type: "number",
        placeholder: "0.72",
        required: true,
        helpText: "Expected C-statistic (0.5-1.0) or Cox-Snell R² (0-max)"
      },
      {
        id: "q6",
        label: "Target shrinkage factor",
        type: "select",
        options: [
          { value: "0.9", label: "0.9 (recommended, ≤10% shrinkage)" },
          { value: "0.85", label: "0.85 (moderate, ≤15% shrinkage)" }
        ],
        required: true,
        helpText: "Shrinkage ≥0.9 minimizes overfitting"
      }
    ],
    buildQuery: function(answers) {
      const parts = [
        `Clinical Prediction Model: ${answers.q1}`,
        ``,
        `Please calculate sample size for **binary outcome prediction model** using Riley et al. (2019) methodology:`,
        ``,
        `**Study Parameters:**`,
        `- Outcome prevalence: ${parseFloat(answers.q2) * 100}%`,
        `- Candidate predictors: ${answers.q3}`,
        `- Expected performance: ${answers.q4 === 'cstat' ? 'C-statistic' : 'Cox-Snell R²'} = ${answers.q5}`,
        `- Target shrinkage: ${answers.q6}`,
        ``,
        `**Riley's 4 Criteria for Binary Outcomes:**`,
        `1. **Criterion B1:** Precise estimation of overall outcome proportion (MOE ≤ 0.05)`,
        `2. **Criterion B2:** Small mean absolute prediction error (MAPE ≤ 0.05)`,
        `3. **Criterion B3:** Target shrinkage factor ≥ ${answers.q6} (minimize overfitting)`,
        `4. **Criterion B4:** Small optimism in R²_Nagelkerke (≤ 0.05)`,
        ``,
        `**Please use R pmsampsize package:**`,
        `\`\`\`r`,
        `library(pmsampsize)`,
        `result <- pmsampsize(`,
        `  type = "b",`,
        `  ${answers.q4 === 'cstat' ? 'cstatistic' : 'csrsquared'} = ${answers.q5},`,
        `  parameters = ${answers.q3},`,
        `  prevalence = ${answers.q2},`,
        `  shrinkage = ${answers.q6}`,
        `)`,
        `print(result)`,
        `\`\`\``,
        ``,
        `**Analysis Requirements:**`,
        `1. Calculate sample size for EACH of the 4 criteria`,
        `2. Final n = MAXIMUM across all criteria`,
        `3. Calculate Events Per Predictor (EPP)`,
        `4. Explain which criterion drives the sample size`,
        `5. Compare to the flawed "10 EPV rule"`,
        `6. Discuss Cox-Snell R² maximum for this prevalence`,
        `7. Provide sensitivity analysis for different R² values`,
        `8. Export comprehensive sample size justification for grant`,
        ``,
        `**Note:** If using C-statistic, pmsampsize will automatically convert to Cox-Snell R² internally.`
      ];
      return parts.join('\n');
    }
  },

  // Template 29: Survival Outcome Prediction Model
  {
    id: "prediction-survival",
    tier: 4,
    title: "Survival Outcome Prediction Model (Riley's Method)",
    description: "Sample size for developing time-to-event prediction models (e.g., cancer recurrence, mortality) using Riley et al. (2019) methodology",
    icon: "⏱️",
    category: "Prediction Models",
    autoFillExample: "I'm developing a prognostic model for cancer recurrence after surgery. I want to predict the 5-year recurrence risk. Based on existing models, I expect a Cox-Snell R² of approximately 0.12. I'm including 20 candidate predictors (tumor characteristics, biomarkers, patient factors). Our registry data shows an event rate of 8.5 per 100 person-years (0.085). The mean follow-up time is expected to be 4.2 years. The key prediction timepoint is 5 years. I need shrinkage ≥ 0.9 to ensure the model won't be overfitted. Please use Riley's methodology via pmsampsize to calculate required sample size and number of events. Explain how this differs from the Schoenfeld formula for trials and why EPP > 20 is recommended.",
    questions: [
      {
        id: "q1",
        label: "Prognostic prediction question",
        type: "textarea",
        placeholder: "e.g., Predict 5-year cancer recurrence after surgery",
        required: true
      },
      {
        id: "q2",
        label: "Event rate per person-year",
        type: "number",
        placeholder: "0.085",
        required: true,
        helpText: "Number of events per 100 person-years ÷ 100"
      },
      {
        id: "q3",
        label: "Key prediction timepoint (years)",
        type: "number",
        placeholder: "5",
        required: true,
        helpText: "Time horizon for risk prediction"
      },
      {
        id: "q4",
        label: "Mean follow-up time (years)",
        type: "number",
        placeholder: "4.2",
        required: true,
        helpText: "Average follow-up duration per participant"
      },
      {
        id: "q5",
        label: "Number of candidate predictors",
        type: "number",
        placeholder: "20",
        required: true
      },
      {
        id: "q6",
        label: "Expected Cox-Snell R²",
        type: "number",
        placeholder: "0.12",
        required: true,
        helpText: "From pilot data or similar published models (conservative estimate)"
      },
      {
        id: "q7",
        label: "Target shrinkage factor",
        type: "select",
        options: [
          { value: "0.9", label: "0.9 (recommended)" },
          { value: "0.85", label: "0.85 (less stringent)" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Survival Prediction Model: ${answers.q1}`,
        ``,
        `Please calculate sample size using **Riley's criteria for survival outcomes**:`,
        ``,
        `**Study Parameters:**`,
        `- Event rate: ${answers.q2} per person-year (${parseFloat(answers.q2) * 100} per 100 person-years)`,
        `- Prediction timepoint: ${answers.q3} years`,
        `- Mean follow-up: ${answers.q4} years`,
        `- Candidate predictors: ${answers.q5}`,
        `- Expected Cox-Snell R²: ${answers.q6}`,
        `- Target shrinkage: ${answers.q7}`,
        ``,
        `**Riley's 3 Criteria for Survival Outcomes:**`,
        `1. **Criterion T1:** Precise overall outcome proportion at timepoint (MOE ≤ 0.05)`,
        `2. **Criterion T2:** Target shrinkage factor ≥ ${answers.q7}`,
        `3. **Criterion T3:** Small optimism in R²_Nagelkerke (≤ 0.05)`,
        ``,
        `**Please use R pmsampsize:**`,
        `\`\`\`r`,
        `library(pmsampsize)`,
        `result <- pmsampsize(`,
        `  type = "s",                    # Survival outcome`,
        `  csrsquared = ${answers.q6},`,
        `  parameters = ${answers.q5},`,
        `  rate = ${answers.q2},           # Event rate per person-year`,
        `  timepoint = ${answers.q3},      # Key prediction time`,
        `  meanfup = ${answers.q4},        # Mean follow-up`,
        `  shrinkage = ${answers.q7}`,
        `)`,
        `print(result)`,
        `\`\`\``,
        ``,
        `**Analysis Requirements:**`,
        `1. Calculate required total sample size (n)`,
        `2. Calculate required number of events`,
        `3. Calculate Events Per Predictor (EPP)`,
        `4. Explain which criterion drives the sample size`,
        `5. Compare to "10 EPV rule" and "20 EPP recommendation"`,
        `6. Calculate expected observed risk at prediction timepoint`,
        `7. Discuss recruitment timeline given event rate`,
        `8. Provide sample size justification narrative for protocol`,
        ``,
        `**Note:** This is for model DEVELOPMENT, not for comparing treatments in a trial.`
      ].join('\n');
    }
  },

  // Template 30: Continuous Outcome Prediction Model
  {
    id: "prediction-continuous",
    tier: 4,
    title: "Continuous Outcome Prediction Model (Riley's Method)",
    description: "Sample size for developing prediction models with continuous outcomes (e.g., BMI, blood pressure, eGFR) using Riley's 4-criteria approach",
    icon: "📊",
    category: "Prediction Models",
    autoFillExample: "I'm developing a prediction model for estimated glomerular filtration rate (eGFR) in patients with chronic kidney disease. The outcome is continuous eGFR in mL/min/1.73m². Based on pilot data, the mean eGFR is 52 mL/min/1.73m² with SD of 18 mL/min/1.73m². I'm including 12 predictors (demographics, comorbidities, medications, baseline labs). I anticipate the model will achieve an R² of about 0.40 based on published models. I need shrinkage ≥ 0.9 to ensure minimal overfitting. Please use Riley's methodology to calculate sample size. Note that for continuous outcomes there are 4 criteria, and we need the MAXIMUM sample size across all criteria.",
    questions: [
      {
        id: "q1",
        label: "Prediction model purpose",
        type: "textarea",
        placeholder: "e.g., Predict eGFR in chronic kidney disease patients",
        required: true
      },
      {
        id: "q2",
        label: "Mean outcome value",
        type: "number",
        placeholder: "52",
        required: true,
        helpText: "Expected mean of the continuous outcome (intercept)"
      },
      {
        id: "q3",
        label: "Outcome standard deviation",
        type: "number",
        placeholder: "18",
        required: true,
        helpText: "SD of the outcome variable"
      },
      {
        id: "q4",
        label: "Number of predictors",
        type: "number",
        placeholder: "12",
        required: true
      },
      {
        id: "q5",
        label: "Expected R²",
        type: "number",
        placeholder: "0.40",
        required: true,
        helpText: "Anticipated proportion of variance explained (0-1)"
      },
      {
        id: "q6",
        label: "Target shrinkage",
        type: "select",
        options: [
          { value: "0.9", label: "0.9 (recommended, ≤10% shrinkage)" },
          { value: "0.85", label: "0.85 (moderate, ≤15% shrinkage)" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `Continuous Outcome Prediction Model: ${answers.q1}`,
        ``,
        `Please calculate sample size using **Riley's criteria for continuous outcomes**:`,
        ``,
        `**Model Specifications:**`,
        `- Mean outcome: ${answers.q2}`,
        `- Outcome SD: ${answers.q3}`,
        `- Number of predictors: ${answers.q4}`,
        `- Expected R²: ${answers.q5}`,
        `- Target shrinkage: ${answers.q6}`,
        ``,
        `**Riley's 4 Criteria for Continuous Outcomes:**`,
        `1. **Criterion C1:** Precise estimation of intercept (mean outcome)`,
        `2. **Criterion C2:** Precise residual variance (<10% multiplicative error) → n ≥ 234 + P`,
        `3. **Criterion C3:** Target shrinkage factor ≥ ${answers.q6}`,
        `4. **Criterion C4:** Small optimism in R² (≤ 0.05)`,
        ``,
        `**Please use R pmsampsize:**`,
        `\`\`\`r`,
        `library(pmsampsize)`,
        `result <- pmsampsize(`,
        `  type = "c",                    # Continuous outcome`,
        `  rsquared = ${answers.q5},      # Regular R² (NOT Cox-Snell for continuous)`,
        `  parameters = ${answers.q4},`,
        `  intercept = ${answers.q2},     # REQUIRED: mean outcome`,
        `  sd = ${answers.q3},            # REQUIRED: outcome SD`,
        `  shrinkage = ${answers.q6}`,
        `)`,
        `print(result)`,
        `\`\`\``,
        ``,
        `**Analysis Requirements:**`,
        `1. Show sample size for each of the 4 criteria`,
        `2. Final n = MAXIMUM(n_C1, n_C2, n_C3, n_C4)`,
        `3. Calculate subjects per parameter`,
        `4. Explain which criterion is most stringent`,
        `5. Note that high R² → lower sample size (unlike binary/survival)`,
        `6. Discuss difference from simple regression power analysis`,
        `7. Provide sensitivity analysis for R² = 0.30, 0.40, 0.50`,
        `8. Export sample size justification for grant proposal`,
        ``,
        `**Key Differences from Binary/Survival:**`,
        `- Use regular R² (not Cox-Snell R²)`,
        `- Must specify intercept AND sd`,
        `- Criterion C2 adds n=234+P for precise residual variance`,
        `- Higher R² actually REDUCES required sample size`
      ].join('\n');
    }
  },

  // Template 31: Prediction Model External Validation
  {
    id: "prediction-validation",
    tier: 4,
    title: "Prediction Model External Validation Sample Size",
    description: "Sample size for validating an existing clinical prediction model in a new setting/population (Riley 2021 Statistics in Medicine)",
    icon: "✓",
    category: "Prediction Models",
    autoFillExample: "I want to externally validate an existing prediction model for in-hospital mortality after cardiac surgery. The published model has a reported C-statistic of 0.78 and includes 10 predictors. In-hospital mortality in our institution is about 3.5%. For external validation, I need to precisely estimate the calibration (calibration slope) and discrimination (C-statistic). Riley et al. (2021) recommend different sample sizes for validating vs developing models. I want the 95% CI for the C-statistic to have a margin of error ≤ 0.05, and I need at least 100 events for stable calibration assessment. Please calculate the required sample size for external validation and explain why it differs from development sample size.",
    questions: [
      {
        id: "q1",
        label: "Prediction model being validated",
        type: "textarea",
        placeholder: "e.g., CHADS2-VASc score for stroke prediction in atrial fibrillation",
        required: true
      },
      {
        id: "q2",
        label: "Outcome type",
        type: "select",
        options: [
          { value: "binary", label: "Binary (yes/no)" },
          { value: "survival", label: "Survival (time-to-event)" },
          { value: "continuous", label: "Continuous" }
        ],
        required: true
      },
      {
        id: "q3",
        label: "Reported C-statistic or R² of model",
        type: "number",
        placeholder: "0.78",
        required: true,
        helpText: "Performance in original development/validation"
      },
      {
        id: "q4",
        label: "Number of predictors in model",
        type: "number",
        placeholder: "10",
        required: true
      },
      {
        id: "q5",
        label: "Outcome prevalence/rate in your population",
        type: "number",
        placeholder: "0.035",
        required: true,
        helpText: "For binary: prevalence. For survival: event rate."
      },
      {
        id: "q6",
        label: "Target margin of error for C-stat/R²",
        type: "select",
        options: [
          { value: "0.05", label: "±0.05 (recommended)" },
          { value: "0.10", label: "±0.10 (less precise)" }
        ],
        required: true,
        helpText: "Half-width of 95% CI"
      },
      {
        id: "q7",
        label: "Validation objective",
        type: "select",
        options: [
          { value: "geographic", label: "Geographic validation (different site)" },
          { value: "temporal", label: "Temporal validation (different time period)" },
          { value: "narrow", label: "Narrow validation (subgroup)" }
        ],
        required: true
      }
    ],
    buildQuery: function(answers) {
      return [
        `External Validation Study: ${answers.q1}`,
        ``,
        `Please calculate sample size for **external validation** study:`,
        ``,
        `**Model Characteristics:**`,
        `- Outcome type: ${answers.q2}`,
        `- Reported performance: ${answers.q3}${answers.q2 === 'continuous' ? ' (R²)' : ' (C-statistic)'}`,
        `- Number of predictors: ${answers.q4}`,
        `- Validation type: ${answers.q7}`,
        ``,
        `**Target Population:**`,
        `- Outcome ${answers.q2 === 'binary' ? 'prevalence' : 'rate'}: ${parseFloat(answers.q5) * 100}%`,
        `- Target precision: ±${answers.q6} for performance metric`,
        ``,
        `**Riley et al. (2021) Validation Criteria:**`,
        ``,
        `For external validation (NOT development), we need:`,
        ``,
        `1. **Precise C-statistic/AUC estimation:**`,
        `   - Target: 95% CI width ≤ ${parseFloat(answers.q6) * 2}`,
        `   - Formula accounts for prevalence and expected C-stat`,
        ``,
        `2. **Stable calibration assessment:**`,
        `   - Minimum 100 events for binary/survival`,
        `   - Minimum 100 observations for continuous`,
        `   - Allows flexible calibration (e.g., loess smoothing)`,
        ``,
        `3. **Decision curve analysis (if planned):**`,
        `   - Requires additional events for net benefit curves`,
        `   - Minimum 200 events recommended`,
        ``,
        `**Please calculate:**`,
        `1. Sample size for precise C-statistic (SE-based method)`,
        `2. Sample size for calibration (rule of thumb: ≥100 events)`,
        `3. Sample size for decision curve analysis (if applicable)`,
        `4. Final n = MAXIMUM across requirements`,
        ``,
        `**Key Differences from Development:**`,
        `- Validation typically needs FEWER participants than development`,
        `- No need for Riley's shrinkage/optimism criteria`,
        `- Focus on precision of performance estimates`,
        `- Calibration assessment more important than discrimination`,
        ``,
        `**Analysis Plan for Validation:**`,
        `1. **Discrimination:** C-statistic with 95% CI`,
        `2. **Calibration:** Calibration plot, slope, intercept`,
        `3. **Clinical utility:** Decision curve analysis`,
        `4. **Updating (if needed):** Re-calibration, coefficient re-estimation`,
        ``,
        `**References:**`,
        `- Riley et al. (2021). Statistics in Medicine. "Minimum sample size for external validation"`,
        `- Vergouwe et al. (2016). Journal of Clinical Epidemiology`,
        ``,
        `Please provide comprehensive sample size justification for validation study protocol.`
      ].join('\n');
    }
  },

  // Template 32: High-Dimensional Prediction Model (Machine Learning)
  {
    id: "prediction-highdim",
    tier: 4,
    title: "High-Dimensional Prediction Model (Machine Learning / Penalized Regression)",
    description: "Sample size for prediction models with many predictors (p >> n), using penalized regression (LASSO, elastic net) or machine learning",
    icon: "🤖",
    category: "Prediction Models",
    autoFillExample: "I'm developing a genomic risk prediction model for breast cancer recurrence using gene expression data. I have 500 candidate gene predictors from RNA-seq analysis. The outcome is 5-year recurrence (binary). Recurrence rate is approximately 22%. I plan to use LASSO or elastic net for variable selection and model building. Riley et al. note that penalized methods may need >10× more events than standard regression for comparable stability. I want to achieve stable variable selection where 80% of truly important predictors are selected in cross-validation. Literature suggests I need Events Per Candidate Predictor (EPCP) of at least 2-5 for LASSO. Please help determine sample size considering: (1) stability of variable selection, (2) prediction performance, (3) cross-validation requirements. Also discuss train/test split and internal validation strategy.",
    questions: [
      {
        id: "q1",
        label: "Prediction task",
        type: "textarea",
        placeholder: "e.g., Genomic prediction of breast cancer recurrence from RNA-seq",
        required: true
      },
      {
        id: "q2",
        label: "Number of candidate predictors",
        type: "number",
        placeholder: "500",
        required: true,
        helpText: "Total features before selection (can be >> sample size)"
      },
      {
        id: "q3",
        label: "Expected number of truly important predictors",
        type: "number",
        placeholder: "20",
        required: true,
        helpText: "Estimated sparsity (how many are actually predictive)"
      },
      {
        id: "q4",
        label: "Outcome type",
        type: "select",
        options: [
          { value: "binary", label: "Binary classification" },
          { value: "survival", label: "Survival / time-to-event" },
          { value: "continuous", label: "Continuous regression" }
        ],
        required: true
      },
      {
        id: "q5",
        label: "Outcome prevalence or rate",
        type: "number",
        placeholder: "0.22",
        required: true,
        helpText: "For binary: prevalence (0-1). For survival: event rate (0-1). Use decimal format: 0.22 = 22%",
        validation: { min: 0.01, max: 1.0, step: 0.01 }
      },
      {
        id: "q6",
        label: "Penalization/ML method",
        type: "select",
        options: [
          { value: "lasso", label: "LASSO (L1 penalty)" },
          { value: "ridge", label: "Ridge (L2 penalty)" },
          { value: "elasticnet", label: "Elastic net (L1+L2)" },
          { value: "ml", label: "Machine learning (random forest, XGBoost, etc.)" }
        ],
        required: true
      },
      {
        id: "q7",
        label: "Expected model performance (C-stat or R²)",
        type: "number",
        placeholder: "0.75",
        required: true,
        helpText: "From pilot data or similar published studies"
      }
    ],
    buildQuery: function(answers) {
      return [
        `High-Dimensional Prediction Model: ${answers.q1}`,
        ``,
        `Please calculate sample size for **high-dimensional prediction modeling**:`,
        ``,
        `**Model Characteristics:**`,
        `- Candidate predictors (p): ${answers.q2}`,
        `- Expected true predictors: ${answers.q3}`,
        `- Outcome type: ${answers.q4}`,
        `- Outcome ${answers.q4 === 'binary' ? 'prevalence' : answers.q4 === 'survival' ? 'event rate' : 'variance'}: ${parseFloat(answers.q5) * 100}%`,
        `- Method: ${answers.q6}`,
        `- Expected performance: ${answers.q7}`,
        ``,
        `**Riley et al. (2020) Notes on Penalized/ML Methods:**`,
        ``,
        `"Machine learning and penalized regression methods may require substantially more events than traditional regression - potentially 10-200× the number of events - to achieve comparable levels of overfitting as standard regression with careful variable selection."`,
        ``,
        `**Sample Size Considerations:**`,
        ``,
        `1. **For Variable Selection Stability (LASSO/Elastic Net):**`,
        `   - Events Per Candidate Predictor (EPCP) ≥ 2-5`,
        `   - For p=${answers.q2}, need ${parseFloat(answers.q5) > 0 ? Math.ceil(answers.q2 * 2 / answers.q5) : 'N/A'} to ${parseFloat(answers.q5) > 0 ? Math.ceil(answers.q2 * 5 / answers.q5) : 'N/A'} total subjects`,
        `   - This ensures stable variable selection in cross-validation`,
        ``,
        `2. **For Selected Model Performance (after selection):**`,
        `   - Apply Riley's criteria to SELECTED predictors (~${answers.q3})`,
        `   - Use pmsampsize with p=${answers.q3}`,
        `   - Ensures final model has low overfitting`,
        ``,
        `3. **For Machine Learning (Random Forest, XGBoost, Neural Nets):**`,
        `   - EPP ≥ 200 recommended (Riley et al.)`,
        `   - Even with >200 EPP, may still see substantial optimism`,
        `   - Requires rigorous nested cross-validation`,
        ``,
        `**Please perform multi-step calculation:**`,
        ``,
        `**Step 1: Variable Selection Phase**`,
        `\`\`\`r`,
        `# LASSO selection: need EPCP ≥ 2-5`,
        `p_candidates <- ${answers.q2}`,
        `prevalence <- ${answers.q5}`,
        ``,
        `# Conservative: EPCP = 5`,
        `events_needed <- p_candidates * 5`,
        `n_selection <- ceiling(events_needed / prevalence)`,
        `cat("For stable variable selection: n ≥", n_selection, "\\n")`,
        `\`\`\``,
        ``,
        `**Step 2: Final Model Validation**`,
        `\`\`\`r`,
        `library(pmsampsize)`,
        `# After LASSO selects ~${answers.q3} predictors`,
        `result <- pmsampsize(`,
        `  type = "${answers.q4 === 'binary' ? 'b' : answers.q4 === 'survival' ? 's' : 'c'}",`,
        `  ${answers.q4 === 'continuous' ? 'rsquared' : 'csrsquared'} = ${answers.q7 === 'continuous' ? answers.q7 : Math.min(0.3, parseFloat(answers.q7) * 0.7)},  # Conservative`,
        `  parameters = ${answers.q3},     # After selection`,
        `  prevalence = ${answers.q5}${answers.q4 === 'continuous' ? ',\n  intercept = [MEAN],\n  sd = [SD]' : ''}`,
        `)`,
        `print(result)`,
        `\`\`\``,
        ``,
        `**Step 3: Internal Validation Strategy**`,
        `- Nested cross-validation (outer loop: performance, inner loop: tuning)`,
        `- Typical: 5×5 or 10×10 nested CV`,
        `- Or: 70/30 train/test split with CV on training set`,
        `- Bootstrap .632+ for bias-corrected performance`,
        ``,
        `**Final Recommendation:**`,
        `n_total = MAX(n_selection, n_Riley, n_validation_adequate)`,
        ``,
        `**Critical Points:**`,
        `1. **DO NOT use Riley's criteria directly for p >> n**`,
        `   - Riley assumes p < n and no variable selection`,
        `   - Must account for selection process separately`,
        ``,
        `2. **Stability of Selected Variables:**`,
        `   - Run CV 100 times with different random seeds`,
        `   - Check how often each variable is selected`,
        `   - Target: ≥80% selection frequency for "important" variables`,
        ``,
        `3. **Expected Optimism:**`,
        `   - Even with large n, penalized methods show optimism`,
        `   - Use rigorous internal validation`,
        `   - Plan for external validation study`,
        ``,
        `4. **Alternative if n insufficient:**`,
        `   - Reduce p through biological filtering`,
        `   - Use domain knowledge for pre-selection`,
        `   - Consider simpler parametric models`,
        ``,
        `**References:**`,
        `- Riley et al. (2020). Statistics in Medicine. "Sample size for ML"`,
        `- Van Calster et al. (2019). BMJ. "Calibration of risk prediction models"`,
        `- Sauerbrei et al. (2020). BMC Medical Research Methodology`,
        ``,
        `Please provide comprehensive sample size calculation with sensitivity analyses.`
      ].join('\n');
    }
  }
];

// Export for browser use
if (typeof window !== 'undefined') {
  window.POWER_AGENT_TEMPLATES = POWER_AGENT_TEMPLATES;
}

// Export for Node.js use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = POWER_AGENT_TEMPLATES;
}
