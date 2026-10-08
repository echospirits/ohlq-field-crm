import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WholesaleAssessmentSummary } from '../app/components/WholesaleAssessmentSummary';
import { assessWholesaleAccount } from '../lib/wholesaleAssessment';
import { sourceCoverage } from '../lib/wholesaleAssessmentCoverage';
import { input, use } from './fixtures/wholesaleAssessment';
(globalThis as any).React=React;
test('rendered summary keeps research-only observed quantities unavailable and separates score/research dates',()=>{
  const result=assessWholesaleAccount(input({purchases:[],uses:[use()],coverage:sourceCoverage({asOf:new Date('2026-09-28'),identity:'UNAVAILABLE',completeDates:new Set(),hasPurchases:false,through:null})}));
  const html=renderToStaticMarkup(React.createElement(WholesaleAssessmentSummary,{value:result,pending:true}));
  assert.match(html,/Research-based/);assert.match(html,/Last scored/);assert.match(html,/Last researched/);
  assert.match(html,/Unavailable \/ Unavailable \/ Unavailable/);assert.match(html,/recalculation is pending/);
  assert.match(html,/<details/);assert.match(html,/Estimated attainable additional volume: unavailable/);assert.doesNotMatch(html,/\$\d/);
});
test('unavailable, qualification and stale states render explicit accessible messages',()=>{
  const empty=renderToStaticMarkup(React.createElement(WholesaleAssessmentSummary,{value:null}));assert.match(empty,/role="status"/);assert.match(empty,/unavailable/);
  const result=assessWholesaleAccount(input({purchases:[],calculatedAt:'2020-01-01',uses:[]}));
  const html=renderToStaticMarkup(React.createElement(WholesaleAssessmentSummary,{value:result}));
  assert.match(html,/Needs qualification\/research/);assert.match(html,/Assessment is stale/);assert.doesNotMatch(html,/Prioritize a dedicated/);
});
