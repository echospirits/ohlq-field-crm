import { publicEncrypt, constants } from 'node:crypto';
import Papa from 'papaparse';
import { downloadOhlqEchoSalesPairs } from '../lib/ohlqAnnualSalesReport';

const key = "-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAqo38I1f724I28BcX71uM\nXHNsBG1r65zYTXYzdRbVboedNsoqriGlM/lnbIYxcQrDKWAZHVQOoyq1oq922/4v\nGdzeaSpsyBqfXWxmsGb+rYl/tsp+sTzMcfm3/L+1Wod2Vn8hg66aF7A0OTtbxHWE\nE9S9AfROl6f4DYigzADwdwpxgQAFmtYZC1VL0I9EkktBo15s4Xl9EFLPfrXqFy+e\nfFhy3o1c/4W5NAvnkPowct00vi/NIL7vfPMYiqP0mK1GFJhNkntvTUL/0Ip2JY8X\nozoOQ5mUv/bNvPBgW8TqMsvM+JuObbRy0SN/JOZ4aQA1N6eftjVd0luh2Trtw7V8\nuV4h1JGGP1CtBomO4umMbygnHQaEUwyZ5FV9mQGtp8hSudlSJ5mel7yOgcyjs5IE\nsJdzxXghO69gAlbPz7hLYhel9FWVGtvBhjIaPLLr73Zvsjz4DTXkg0cE5zXuZXb4\nUnFP8PCAlYh+RHg2b9Mc508v7dPly06I+SdGi26OfYmfAgMBAAE=\n-----END PUBLIC KEY-----\n";
const date = '2020-08-20';
const echo = 'Z90399001';
type Csv = { data: Record<string, string>[]; errors: unknown[]; meta: { fields?: string[] } };
function nativeRows(bytes: Buffer, fields: string[], vendorColumn: string) {
  const p = Papa.parse(bytes.toString('utf8'), { header: true, skipEmptyLines: true, transformHeader: (h: string) => h.trim().replace(/^\uFEFF/, '') }) as Csv;
  if (p.errors.length || fields.some(f => !p.meta.fields?.includes(f))) throw Error('Invalid native CSV shape.');
  return p.data.filter(r => r[vendorColumn]?.trim() === echo);
}
function qty(raw: string) {
  const text = raw?.trim();
  if (!text) return 0;
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) throw Error('Invalid quantity.');
  const n = Number(text.replaceAll(',', ''));
  if (!Number.isSafeInteger(n)) throw Error('Invalid quantity.');
  return n;
}
async function main() {
  if (process.env.GITHUB_REPOSITORY !== 'echospirits/ohlq-field-crm' ||
      process.env.GITHUB_REF !== 'refs/heads/codex/echo-aug20-duplicate-source-audit') throw Error('Invalid diagnostic context.');
  await downloadOhlqEchoSalesPairs([date], { headless: true, logger: { log() {}, error() {} } }, () => {}, async (summary, wholesale) => {
    const p = wholesale.echoWholesaleExport;
    const s = summary.summaryNativeExport;
    if (!p || p.reportIdentity !== 'dea7572c-2ea4-45bb-bbbc-29600bd326cc' || p.date !== date || p.verifiedEmpty || p.statewide ||
        !s || s.requestedFrom !== date || s.requestedTo !== date || !summary.csvBuffer?.length ||
        summary.csvBuffer.length !== summary.sizeBytes || !wholesale.csvBuffer?.length ||
        wholesale.csvBuffer.length !== wholesale.sizeBytes) throw Error('Incomplete native export evidence.');
    const fields = ['Agency_Id', 'Brand', 'Wholesale_Bottles_Sold'];
    const gross = nativeRows(summary.csvBuffer, [...fields, 'Vendor'], 'Vendor');
    const details = nativeRows(wholesale.csvBuffer, [...fields, 'DimVendor_VendorNumber_', 'Permit_Number'], 'DimVendor_VendorNumber_');
    const groups = new Map<string, Record<string, string>[]>();
    for (const row of details) {
      const k = JSON.stringify([row.Agency_Id.trim(), row.Brand.trim(), row.Permit_Number.trim()]);
      const prior = groups.get(k) ?? [];
      prior.push(row);
      groups.set(k, prior);
    }
    for (const [k, rows] of groups) {
      if (rows.length < 2) continue;
      const [agencyId, productCode, permit] = JSON.parse(k) as string[];
      const matchesItem = (row: Record<string,string>) => row.Agency_Id.trim() === agencyId && row.Brand.trim() === productCode;
      const result = { agencyId, productCode, permit, repeatedBottles: rows.map(r => qty(r.Wholesale_Bottles_Sold)),
        identicalSourceRows: rows.every(r => JSON.stringify(r) === JSON.stringify(rows[0])),
        summaryBottles: gross.filter(matchesItem).reduce((n,r)=>n+qty(r.Wholesale_Bottles_Sold),0),
        detailBottles: details.filter(matchesItem).reduce((n,r)=>n+qty(r.Wholesale_Bottles_Sold),0) };
      const payload = publicEncrypt({ key, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Uint8Array.from(Buffer.from(JSON.stringify(result),'utf8')));
      console.log('SEALED_DUPLICATE_GROUP ' + payload.toString('base64'));
    }
  });
}
main().catch(() => { console.error('Could not validate and seal duplicate evidence.'); process.exitCode = 1; });
