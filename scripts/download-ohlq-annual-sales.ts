import fs from 'fs';
import path from 'path';
import { downloadOhlqAnnualSalesSummary } from '../lib/ohlqAnnualSalesReport';

function loadEnvFile(fileName: string) {
  const envPath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

downloadOhlqAnnualSalesSummary()
  .then((result) => {
    console.log(
      JSON.stringify(
        {
          outputPath: result.outputPath,
          reportDate: result.reportDate,
          runDate: result.runDate,
          sizeBytes: result.sizeBytes,
        },
        null,
        2,
      ),
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
