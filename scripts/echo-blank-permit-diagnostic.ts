import { publicEncrypt, constants } from 'node:crypto';
import Papa from 'papaparse';
import { downloadOhlqEchoSalesPairs } from '../lib/ohlqAnnualSalesReport';

const key = "-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAqo38I1f724I28BcX71uM\nXHNsBG1r65zYTXYzdRbVboedNsoqriGlM/lnbIYxcQrDKWAZHVQOoyq1oq922/4v\nGdzeaSpsyBqfXWxmsGb+rYl/tsp+sTzMcfm3/L+1Wod2Vn8hg66aF7A0OTtbxHWE\nE9S9AfROl6f4DYigzADwdwpxgQAFmtYZC1VL0I9EkktBo15s4Xl9EFLPfrXqFy+e\nfFhy3o1c/4W5NAvnkPowct00vi/NIL7vfPMYiqP0mK1GFJhNkntvTUL/0Ip2JY8X\nozoOQ5mUv/bNvPBgW8TqMsvM+JuObbRy0SN/JOZ4aQA1N6eftjVd0luh2Trtw7V8\nuV4h1JGGP1CtBomO4umMbygnHQaEUwyZ5FV9mQGtp8hSudlSJ5mel7yOgcyjs5IE\nsJdzxXghO69gAlbPz7hLYhel9FWVGtvBhjIaPLLr73Zvsjz4DTXkg0cE5zXuZXb4\nUnFP8PCAlYh+RHg2b9Mc508v7dPly06I+SdGi26OfYmfAgMBAAE=\n-----END PUBLIC KEY-----\n";
const expected = new Map([['2021-08-06', 2], ['2021-07-21', 1]]);
const vendor = 'Z90399001';
const report = 'dea7572c-2ea4-45bb-bbbc-29600bd326cc';
const results: { date: string; agencyId: string; productCode: string; bottles: number }[] = [];
async function main() {
  if (process.env.GITHUB_REPOSITORY !== 'echospirits/ohlq-field-crm' ||
      process.env.GITHUB_REF !== 'refs/heads/codex/echo-blank-permit-diagnostics-2021') throw Error('Unexpected diagnostic context.');
  await downloadOhlqEchoSalesPairs([...expected.keys()], { headless: true, logger: { log() {}, error() {} } }, () => {}, async (_, wholesale) => {
    const proof = wholesale.echoWholesaleExport;
    const date = wholesale.reportDate;
    const bytes = wholesale.csvBuffer;
    if (!proof || proof.reportIdentity !== report || proof.date !== date || !expected.has(date) ||
        proof.statewide || proof.verifiedEmpty || !bytes?.length || wholesale.sizeBytes !== bytes.length) {
      throw Error('Incomplete native source evidence.');
    }
    const parsed = Papa.parse(bytes.toString('utf8'), {
      header: true, skipEmptyLines: true, transformHeader: (h: string) => h.trim().replace(/^\uFEFF/, ''),
    }) as { data: Record<string, string>[]; errors: unknown[]; meta: { fields?: string[]; renamedHeaders?: Record<string, string> } };
    const fields = ['Agency_Id', 'Brand', 'DimVendor_VendorNumber_', 'Permit_Number', 'Wholesale_Bottles_Sold'];
    if (parsed.errors.length || Object.keys(parsed.meta.renamedHeaders ?? {}).length ||
        fields.some(field => !parsed.meta.fields?.includes(field)) ||
        parsed.data.some(row => row.DimVendor_VendorNumber_?.trim() !== vendor || !row.Agency_Id?.trim() || !row.Brand?.trim())) {
      throw Error('Invalid export structure.');
    }
    const missing = parsed.data.filter(row => !row.Permit_Number?.trim());
    if (missing.length !== expected.get(date)) throw Error('Unexpected count of blank permits.');
    for (const row of missing) {
      const quantity = row.Wholesale_Bottles_Sold?.trim();
      if (!quantity || !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(quantity)) throw Error('Invalid bottle quantity.');
      const bottles = Number(quantity.replaceAll(',', ''));
      if (!Number.isSafeInteger(bottles)) throw Error('Invalid bottle quantity.');
      results.push({ date, agencyId: row.Agency_Id.trim(), productCode: row.Brand.trim(), bottles });
    }
  });
  for (const row of results) {
    const plaintext = Buffer.from(JSON.stringify(row), 'utf8');
    const payload = publicEncrypt({ key, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Uint8Array.from(plaintext));
    console.log('SEALED_BLANK_PERMIT_ROW ' + payload.toString('base64'));
  }
}
main().catch(() => { console.error('Could not validate and seal the source rows.'); process.exitCode = 1; });
