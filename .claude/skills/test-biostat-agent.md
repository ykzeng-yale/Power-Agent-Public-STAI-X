# Test Biostat Agent Skill

Test the biostatistics agent with comprehensive E2E tests.

## Description

This skill runs end-to-end tests on the deployed biostatistics agent to verify:
- Sample size calculations (various designs)
- Power analysis (different scenarios)
- Output file generation
- Error handling
- Performance metrics

## When to Use

Use this skill when:
- After deploying a new backend revision
- Before releasing to production
- After making changes to agent logic
- For regression testing
- To verify all use cases work correctly

## What This Skill Does

1. **Quick Test**: Runs a single CRT sample size test (2-3 minutes)
2. **Comprehensive Test**: Runs all 10 test cases covering diverse scenarios (30-40 minutes)
3. **Custom Test**: Runs a specific test query you provide

The skill will:
- Send requests to the deployed backend
- Stream and parse SSE responses
- Verify output file generation
- Check for errors
- Report success/failure with detailed metrics
- Generate summary statistics

## Test Categories Covered

### Sample Size Calculations
- Cluster randomized trials (CRT)
- ANOVA multi-group designs
- Proportion comparisons
- Repeated measures designs
- Non-inferiority trials

### Power Analysis
- Two-sample t-tests
- Survival analysis
- Correlation tests
- Mixed effects models
- Multiple testing corrections

## Test Outputs

Each test verifies:
- ✅ Analysis completes without errors
- ✅ Output files generated (reports, CSVs, plots)
- ✅ Professional chatbot communication
- ✅ Correct R code execution
- ✅ Reasonable performance (< 5 minutes per test)

## Usage Examples

### Quick Test (Single Test)
```
Use the test-biostat-agent skill to run a quick test
```

### Comprehensive Test (All Cases)
```
Use the test-biostat-agent skill to run comprehensive tests
```

### Custom Test Query
```
Use the test-biostat-agent skill to test: "Calculate power for logistic regression with 5 predictors, N=200, R²=0.25, alpha=0.05"
```

## Notes

- Tests run against the production backend URL
- Each test has a 5-minute timeout
- Tests pause 5 seconds between runs to avoid rate limits
- Failed tests will show detailed error information
- All test results are logged with timestamps and metrics
