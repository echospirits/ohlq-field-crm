import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TargetOpportunityType } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  buildHeatLossRules,
  buildScoreExplanation,
  buildTargetRecommendation,
  parseTargetAccountWorkbook,
} from '../lib/targetAccountWorkbook';

const makeWorkbookBuffer = async (overrides: Partial<Record<string, unknown[][]>> = {}) => {
  const workbook = new ExcelJS.Workbook();
  const sheets: Record<string, unknown[][]> = {
    'Top Prospects': [
      [
        'Baseline Rank',
        'Priority Tier',
        'Account',
        'Account Type',
        'City',
        'Zip',
        'Address',
        'Permit Number',
        'Location Confidence',
        'Strategic Flag',
        'Data Score',
        'Public Fit Score',
        'Blended Score',
        'Months Active',
        'Total 9L Cases',
        'Avg Monthly 9L',
        'Wholesale Spend',
        'Price-Fit 9L',
        'Portfolio Category 9L',
        'Price Fit %',
        'Portfolio Price Median',
        'Premium Bottle Share %',
        'Other Ohio Craft 9L',
        'Other Ohio Craft Vendors',
        'Buys Other Ohio Craft',
        'American Whiskey 9L',
        'Rum 9L',
        'Vodka 9L',
        'Cordial 9L',
        'Momentum Score',
        'Research Status',
        'Patio / Outdoor',
        'Cocktail Focus',
        'Popularity Signal',
        'Events / Groups',
        'Research Notes',
        'Maps Search URL',
        'Source URL 1',
        'Source URL 2',
        'Fit Volume Percentile',
        'Total Volume Percentile',
        'Ohio Craft Affinity Score',
        'Consistency Score',
        'Ohio Craft Volume Percentile',
        'Website URL',
        'Cocktail Menu URL',
        'Local Brands on Menu',
        'Google Rating',
        'Google Reviews',
        'Yelp Rating',
        'Yelp Reviews',
        'National Chain',
      ],
      [
        1,
        'A',
        'Scioto Country Club',
        'Country/Golf Club',
        'UPPER ARLINGTON',
        '43221',
        '2196 RIVERSIDE DR',
        '10001608-1',
        'Verified',
        '',
        96.8,
        75,
        93.5,
        6,
        368.3,
        61.3,
        108207,
        246.1,
        273.5,
        89.7,
        26.99,
        23.2,
        2.9,
        5,
        'Yes',
        59,
        17,
        186,
        10,
        100,
        'Researched 2026-07-14',
        'Unknown',
        'Moderate',
        'High',
        'Yes',
        'Private club with dining and events.',
        'https://maps.example.com/scioto',
        'https://example.com/scioto',
        '',
        99.6,
        98.1,
        91.8,
        100,
        83.7,
        'https://example.com',
        'https://example.com/cocktails',
        'Watershed; Middle West',
        4.7,
        1250,
        4.5,
        340,
        'No',
      ],
    ],
    'Research Queue': [
      [
        'Queue Rank',
        'Priority',
        'Account',
        'City',
        'Zip',
        'Data Score',
        'Public Fit',
        'Blended Score',
        'Research Status',
        'Next Action',
        'Maps Search URL',
      ],
      [1, 'A', 'Scioto Country Club', 'UPPER ARLINGTON', '43221', 96.8, 75, 93.5, 'Researched', 'Pitch', 'https://maps.example.com'],
    ],
    'Existing Growth': [
      [
        'Baseline Rank',
        'Priority',
        'Account',
        'City',
        'Zip',
        'Permit Number',
        'Account Type',
        'Strategic Flag',
        'Location Confidence',
        'Expansion Score',
        'ETOHIO 9L',
        'ETOHIO Items',
        'ETOHIO Categories',
        'Category Whitespace %',
        'Portfolio Category 9L',
        'Price-Fit 9L',
        'Total 9L',
        'Other Ohio Craft 9L',
        'Buys Other Ohio Craft',
        'Months Active',
        'Avg Monthly 9L',
        'Maps Search URL',
        'Portfolio Volume Percentile',
        'ETOHIO Volume Percentile',
        'Existing Ohio Craft Percentile',
        'Consistency Score',
        'Ohio Craft Affinity',
      ],
      [
        2,
        'A',
        'Existing Buyer',
        'COLUMBUS',
        '43215',
        '00072045-1',
        'Restaurant',
        '',
        'Verified',
        82,
        10,
        2,
        'Vodka',
        75,
        200,
        180,
        300,
        12,
        'Yes',
        6,
        50,
        'https://maps.example.com/existing',
        90,
        60,
        80,
        100,
        90,
      ],
    ],
    'Chain Opportunities': [
      [
        'Chain Rank',
        'Ownership / Group',
        'Unique Locations',
        'Unserved Locations',
        'Current ETOHIO Locations',
        'Chain Leverage Score',
        'Price-Fit 9L',
        'Total 9L Cases',
        'ETOHIO 9L',
        'Other Ohio Craft 9L',
        'Max Data Score',
        'Avg Data Score',
        'Strategic Note',
        'Location Review',
        'Locations',
      ],
      [1, 'Cameron Mitchell', 3, 2, 1, 88, 500, 900, 20, 50, 97, 90, 'Start with best buyer.', 'Review', 'Location A; Location B'],
    ],
    'All Active Central': [
      ['Account', 'Ownership', 'DBA', 'Account Type', 'City', 'Zip', 'Address', 'Permit Number'],
      ['Scioto Country Club', 'Independent', '', 'Country/Golf Club', 'UPPER ARLINGTON', '43221', '2196 RIVERSIDE DR', '10001608-1'],
      ['Existing Buyer', 'Cameron Mitchell', '', 'Restaurant', 'COLUMBUS', '43215', '1 HIGH ST', '00072045-1'],
    ],
    'ETOHIO Portfolio': [
      ['Item', 'Brand / Search Name', 'Category', 'Retail Price', 'Wholesale Price', 'Volume oz', 'Status Code', 'Core Coverage File'],
      ['0100A', 'Echo Whiskey', 'American Whiskey', 29.99, 20, 750, 'A', 'core.csv'],
      ['0200B', 'Echo Rum', 'Rum', 24.99, 18, 750, 'A', 'core.csv'],
      ['0300C', 'Echo Vodka', 'Vodka', 19.99, 15, 750, 'A', 'core.csv'],
    ],
    ...overrides,
  };

  Object.entries(sheets).forEach(([name, values]) => {
    const worksheet = workbook.addWorksheet(name);
    worksheet.addRows(values);
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe('parseTargetAccountWorkbook', () => {
  it('maps workbook sheets and parses target rows, chain rows, and ownership', async () => {
    const parsed = await parseTargetAccountWorkbook(await makeWorkbookBuffer());

    assert.equal(parsed.warnings.length, 0);
    assert.equal(parsed.failedRows.length, 0);
    assert.equal(parsed.accountRows.length, 2);
    assert.equal(parsed.chainRows.length, 1);
    assert.equal(parsed.portfolioSkus.length, 3);
    assert.equal(parsed.accountRows[0].permitNumber, '10001608-1');
    assert.equal(parsed.accountRows[0].ownership, 'Independent');
    assert.equal(parsed.accountRows[0].googleRating, 4.7);
    assert.equal(parsed.accountRows[0].googleReviewCount, 1250);
    assert.equal(parsed.accountRows[0].isNationalChain, false);
    assert.deepEqual(parsed.accountRows[0].localBrandsOnMenu, ['Watershed', 'Middle West']);
    assert.equal(parsed.accountRows[1].existingBuyer, true);
    assert.deepEqual(parsed.chainRows[0].locations, ['Location A', 'Location B']);
  });

  it('reports missing required columns clearly', async () => {
    const parsed = await parseTargetAccountWorkbook(
      await makeWorkbookBuffer({
        'Top Prospects': [['Account', 'Priority Tier'], ['Missing Permit', 'A']],
      }),
    );
    const topProspectsMapping = parsed.mappings.find((mapping) => mapping.sheetName === 'Top Prospects');

    assert.ok(topProspectsMapping?.missingRequired.includes('permitNumber'));
    assert.ok(topProspectsMapping?.missingRequired.includes('baselineRank'));
    assert.ok(parsed.warnings.some((warning) => warning.sheetName === 'Top Prospects'));
  });

  it('produces stable source row hashes for repeated imports', async () => {
    const buffer = await makeWorkbookBuffer();
    const first = await parseTargetAccountWorkbook(buffer);
    const second = await parseTargetAccountWorkbook(buffer);

    assert.equal(first.sourceWorkbookHash, second.sourceWorkbookHash);
    assert.equal(first.accountRows[0].sourceRowHash, second.accountRows[0].sourceRowHash);
  });
});

describe('target recommendations and alerts', () => {
  it('recommends a missing category for existing-account expansion', async () => {
    const parsed = await parseTargetAccountWorkbook(await makeWorkbookBuffer());
    const existingBuyer = parsed.accountRows.find((row) => row.existingBuyer);
    assert.ok(existingBuyer);

    const recommendation = buildTargetRecommendation(existingBuyer, parsed.portfolioSkus);

    assert.equal(recommendation.opportunityType, TargetOpportunityType.EXISTING_ACCOUNT_EXPANSION);
    assert.equal(recommendation.category, 'American Whiskey');
    assert.equal(recommendation.itemCode, null);
    assert.equal(recommendation.productName, 'American Whiskey opportunity');
    assert.doesNotMatch(recommendation.recommendedNextAction, /pitch/i);
    assert.ok(recommendation.reasons.some((reason) => reason.includes('Missing portfolio categories')));
  });

  it('generates explainable scoring text from component values', async () => {
    const parsed = await parseTargetAccountWorkbook(await makeWorkbookBuffer());
    const explanation = buildScoreExplanation(parsed.accountRows[0]);

    assert.match(explanation, /whiskey volume|premium-price fit|Ohio craft/);
  });

  it('flags high-priority heat-loss and expansion follow-up gaps', async () => {
    const parsed = await parseTargetAccountWorkbook(await makeWorkbookBuffer());
    const alerts = buildHeatLossRules({
      hasActiveOpportunity: false,
      hasNextAction: false,
      row: parsed.accountRows[1],
    });

    assert.ok(alerts.some((alert) => alert.type === 'A_TIER_NO_NEXT_ACTION'));
    assert.ok(alerts.some((alert) => alert.type === 'HIGH_EXPANSION_NO_OPPORTUNITY'));
  });
});
