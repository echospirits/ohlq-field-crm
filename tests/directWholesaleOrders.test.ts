import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { generateDirectWholesaleOrderPdf } from '../lib/directWholesaleOrderPdf';
import { calculateDirectWholesaleOrderTotals } from '../lib/directWholesaleOrders';

test('direct wholesale totals use currency-safe rounding', () => {
  assert.deepEqual(calculateDirectWholesaleOrderTotals([
    { itemCode: '4216L', quantityBottles: 11, wholesalePrice: 4.7 },
    { itemCode: '2849B', quantityBottles: 3, wholesalePrice: 33.84 },
  ], 1.005), {
    lineSubtotals: [51.7, 101.52],
    sinTax: 1.01,
    subtotal: 153.22,
    total: 154.23,
  });
});

test('generated A-3a PDF is flattened and contains no interactive form fields', async () => {
  const bytes = await generateDirectWholesaleOrderPdf({
    a3aSignature: 'Joseph R Bidinger',
    customer: {
      address: '28 S. State St & Patios', city: 'Westerville', dba: 'High Bank Distillery', f2Permit: false,
      name: 'Life in the Ville V LLC', permitNumber: '5190028', phone: '', postalCode: '43081', state: 'OH',
    },
    customerSignature: 'Rob Gelley',
    lines: [{ itemCode: '2849B', itemName: 'Genever', quantityBottles: 3, wholesalePrice: 33.84 }],
    saleDate: '2026-08-11',
    seller: { addressLine1: '985 W 6th Ave', city: 'Columbus', email: 'joe@echospirits.com', name: 'Echo Spirits', phone: '', postalCode: '43212', state: 'OH', storeId: '90399' },
    sinTax: 0,
  });
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getForm().getFields().length, 0);
  assert.match(pdf.getTitle() ?? '', /High Bank Distillery/);
});
