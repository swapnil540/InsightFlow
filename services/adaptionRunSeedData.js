const fs = require('fs');
const path = require('path');

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function buildAdaptionRunSeedData(root = path.resolve(__dirname, '..')) {
  const full = readJson(root, 'data/adaption_run.json');
  const retest = readJson(root, 'data/adaption_retest_run.json');
  const smoke = readJson(root, 'pipeline/out/smoke_test_state.json');
  const smokeEvaluation = smoke.evaluation;
  const smokeMetrics = smokeEvaluation.raw_results.summary;

  const records = [
    {
      runId: smoke.run_id,
      datasetId: smoke.dataset_id,
      role: 'smoke_test',
      status: smoke.final_status.status,
      rowsIn: smoke.final_status.row_count,
      rowsOut: smoke.final_status.row_count,
      scoreBefore: smokeEvaluation.quality.score_before,
      scoreAfter: smokeEvaluation.quality.score_after,
      gradeBefore: smokeEvaluation.quality.grade_before,
      gradeAfter: smokeEvaluation.quality.grade_after,
      percentile: smokeEvaluation.quality.percentile_after,
      improvementPercent: smokeEvaluation.quality.improvement_percent,
      evaluatedOnRows: null,
      messageQualityBefore: smokeMetrics.message_quality.before,
      messageQualityAfter: smokeMetrics.message_quality.after,
      completionQualityBefore: smokeMetrics.completion_quality.before,
      completionQualityAfter: smokeMetrics.completion_quality.after,
      credits: null,
      minutes: null,
      notes: `Estimated credits: ${smoke.estimate.estimated_credits_consumed}; estimated minutes: ${smoke.estimate.estimated_minutes}. Actual spend and elapsed runtime were not recorded.`,
      config: {
        prompt: smoke.prompt,
        columnMapping: smoke.column_mapping,
        recipes: smoke.recipes,
        brandControls: smoke.brand_controls,
        jobSpecification: smoke.job_specification,
      },
    },
    {
      runId: retest.runId,
      datasetId: retest.datasetId,
      role: 'labels',
      status: retest.status,
      rowsIn: retest.rowsIn,
      rowsOut: retest.rowsOut,
      scoreBefore: null,
      scoreAfter: null,
      gradeBefore: null,
      gradeAfter: null,
      percentile: null,
      improvementPercent: null,
      evaluatedOnRows: null,
      messageQualityBefore: null,
      messageQualityAfter: null,
      completionQualityBefore: null,
      completionQualityAfter: null,
      credits: retest.actualCredits,
      minutes: retest.minutes,
      notes: 'This labels retest has no evaluation of its own; the stored evaluation metadata belongs to the first full run.',
      config: retest.configuration,
    },
    {
      runId: full.runId,
      datasetId: full.datasetId,
      role: 'evaluation',
      status: full.status,
      rowsIn: full.rowsIn,
      rowsOut: full.rowsOut,
      scoreBefore: full.evaluation.scoreBefore,
      scoreAfter: full.evaluation.scoreAfter,
      gradeBefore: full.evaluation.gradeBefore,
      gradeAfter: full.evaluation.gradeAfter,
      percentile: full.evaluation.percentileAfter,
      improvementPercent: full.evaluation.improvementPercent,
      evaluatedOnRows: full.evaluation.sampleSize,
      // These four component metrics were supplied in the user's Step 3 request;
      // they are not present in data/adaption_run.json.
      messageQualityBefore: 9.16,
      messageQualityAfter: 9.11,
      completionQualityBefore: 0.97,
      completionQualityAfter: 9.87,
      credits: full.actualCredits,
      minutes: full.minutes,
      notes: 'The source file had no completions, so most of the quality gain comes from Adaption generating them; prompt quality was essentially unchanged.',
      config: full.configuration,
    },
  ];

  if (records.length !== 3 || new Set(records.map((record) => record.runId)).size !== 3) {
    throw new Error('Expected exactly three Adaption run records with unique run IDs.');
  }
  return records;
}

module.exports = { buildAdaptionRunSeedData };
