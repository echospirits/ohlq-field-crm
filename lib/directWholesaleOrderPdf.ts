import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { calculateDirectWholesaleOrderTotals, MAX_DIRECT_WHOLESALE_ORDER_LINES, type DirectWholesaleOrderLineInput } from './directWholesaleOrders';

export type DirectWholesaleOrderPdfInput = {
  a3aSignature: string;
  customer: {
    address: string;
    city: string;
    dba: string;
    f2Permit: boolean;
    name: string;
    permitNumber: string;
    phone: string;
    postalCode: string;
    state: string;
  };
  customerSignature: string;
  lines: Array<DirectWholesaleOrderLineInput & { itemName: string }>;
  saleDate: string;
  seller: {
    addressLine1: string;
    city: string;
    email: string;
    name: string;
    phone: string;
    postalCode: string;
    state: string;
    storeId: string;
  };
  sinTax: number;
};

const templatePath = path.join(process.cwd(), 'public', 'forms', 'ohio-a3a-direct-wholesale-template.pdf');
const formatMoney = (value: number) => value.toFixed(2);
const formatPdfDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return `${month}/${day}/${year}`;
};

export async function generateDirectWholesaleOrderPdf(input: DirectWholesaleOrderPdfInput) {
  const template = await readFile(templatePath);
  const pdf = await PDFDocument.load(new Uint8Array(template));
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const totals = calculateDirectWholesaleOrderTotals(input.lines, input.sinTax);
  const setText = (name: string, value: string) => form.getTextField(name).setText(value);

  setText('Name of A-3a', `${input.seller.name} (${input.seller.storeId})`);
  setText('A3A Address 1', input.seller.addressLine1);
  setText('CITYA3a', input.seller.city);
  setText('State', input.seller.state);
  setText('ZIP', input.seller.postalCode);
  setText('A-3a Phone', input.seller.phone);
  setText('Email Adress of A-3a', input.seller.email);
  setText('Name of WSC Customer', input.customer.name);
  setText('Customer DBA', input.customer.dba);
  setText('Physical Address of A-3a2', input.customer.address);
  setText('City2', input.customer.city);
  setText('State', input.customer.state);
  setText('Postal', input.customer.postalCode);
  setText('Customer Phome', input.customer.phone);
  setText('Text1', input.customer.permitNumber);
  setText('Sales Date', formatPdfDate(input.saleDate));
  form.getDropdown('F2 Permit?').select(input.customer.f2Permit ? 'Yes' : 'No');
  setText('Text6', input.a3aSignature);
  setText('Text7', input.customerSignature);

  for (let index = 0; index < MAX_DIRECT_WHOLESALE_ORDER_LINES; index += 1) {
    const row = index + 1;
    const line = input.lines[index];
    setText(`Brand CodeRow${row}`, line?.itemCode ?? '');
    setText(`Product NameRow${row}`, line?.itemName ?? '');
    setText(`Quantity BottlesRow${row}`, line ? String(line.quantityBottles) : '');
    setText(`Price Per BottleRow${row}`, line ? formatMoney(line.wholesalePrice) : '');
    setText(`Item SubtotalRow${row}`, line ? formatMoney(totals.lineSubtotals[index]) : '');
  }
  setText('Item SubtotalSIN tax if applicable', input.sinTax ? formatMoney(totals.sinTax) : '');
  setText('Item SubtotalInvoice Total', formatMoney(totals.total));

  for (const buttonName of ['SAVE', 'RESET', 'Clear Customer Info']) {
    const field = form.getFieldMaybe(buttonName);
    if (field) form.removeField(field);
  }
  form.updateFieldAppearances(font);
  form.flatten();
  pdf.catalog.delete(PDFName.of('Names'));
  pdf.catalog.delete(PDFName.of('OpenAction'));
  pdf.catalog.delete(PDFName.of('AA'));
  pdf.setTitle(`A-3a Direct Sale - ${input.customer.dba || input.customer.name} - ${input.saleDate}`);
  pdf.setSubject('A-3a Direct Sale to Wholesale Customer');
  pdf.setCreator('Neat');
  pdf.setProducer('Neat');
  return pdf.save();
}
