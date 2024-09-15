const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const readline = require('readline');

puppeteer.use(StealthPlugin());

const FILE_NAME = 'random_sample_200k.csv';
const BATCH_SIZE = 10;
const DELAY_BETWEEN_REQUESTS = { min: 10000, max: 20000 };
const RESUME_FROM_CHECKPOINT = 1660; // Set this to the checkpoint number you want to resume from

function delay(time) {
  return new Promise(function(resolve) {
    setTimeout(resolve, time);
  });
}

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  fs.appendFileSync('scraper.log', `[${timestamp}] ${message}\n`);
}

function waitForUserInput(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => rl.question(question, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function checkForCaptcha(page) {
  const captchaSelector = 'form#captcha-form';
  const isCaptchaPresent = await page.$(captchaSelector) !== null;
  if (isCaptchaPresent) {
    log('CAPTCHA detected. Please solve it manually.');
    await page.screenshot({ path: 'captcha.png' });
    log('CAPTCHA screenshot saved as captcha.png');
    await waitForUserInput('Please solve the CAPTCHA and press Enter when done...');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  }
}

async function searchPaperCitations(page, fullTitle) {
  const title = fullTitle.replace(/\s+/g, ' ').trim();
  log(`Searching for: ${title}`);
  
  const searchUrl = `https://scholar.google.com/scholar?hl=en&q=${encodeURIComponent(title)}`;
  await page.goto(searchUrl, { waitUntil: 'networkidle2' });
  
  await checkForCaptcha(page);

  const currentUrl = page.url();
  log(`Current URL: ${currentUrl}`);

  const pageText = await page.evaluate(() => document.body.innerText);
  
  const citationMatch = pageText.match(/Cited by (\d+)/);
  
  if (citationMatch) {
    const citations = parseInt(citationMatch[1], 10);
    log(`Citations found: ${citations}`);
    return citations;
  } else {
    log('No citations found for this paper');
    return null;
  }
}

async function main() {
  log('Starting the Google Scholar Citation Scraper');
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

  let results = [];
  let processedRows = 0;

  log(`Reading input file: ${FILE_NAME}`);
  
  // Read the checkpoint file if it exists
  const checkpointFile = `updated_citations_checkpoint_${RESUME_FROM_CHECKPOINT}.csv`;
  if (fs.existsSync(checkpointFile)) {
    results = await new Promise((resolve) => {
      const checkpointResults = [];
      fs.createReadStream(checkpointFile)
        .pipe(csv())
        .on('data', (row) => checkpointResults.push(row))
        .on('end', () => resolve(checkpointResults));
    });
    processedRows = RESUME_FROM_CHECKPOINT;
    log(`Resumed from checkpoint: ${checkpointFile}`);
  } else {
    log(`Checkpoint file not found: ${checkpointFile}. Starting from the beginning.`);
  }

  // Read all rows from the original file
  const allRows = await new Promise((resolve) => {
    const rows = [];
    fs.createReadStream(FILE_NAME)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows));
  });

  // If we resumed from a checkpoint, replace the first processedRows with the checkpoint data
  if (processedRows > 0) {
    allRows.splice(0, processedRows, ...results);
  }

  log(`Total rows to process: ${allRows.length}`);

  for (let i = processedRows; i < allRows.length; i++) {
    const row = allRows[i];
    if (row.title && row.title.match(/^[a-zA-Z0-9\s\-:]+$/)) {
      const citations = await searchPaperCitations(page, row.title);
      row.cited_by = citations !== null ? citations.toString() : '';
      
      const delayTime = Math.random() * (DELAY_BETWEEN_REQUESTS.max - DELAY_BETWEEN_REQUESTS.min) + DELAY_BETWEEN_REQUESTS.min;
      log(`Waiting for ${Math.round(delayTime / 1000)} seconds before next request`);
      await delay(delayTime);
    } else {
      log(`Skipping invalid title: ${row.title}`);
      row.cited_by = '';
    }

    processedRows++;

    if (processedRows % BATCH_SIZE === 0) {
      const filename = `updated_citations_checkpoint_${processedRows}.csv`;
      await saveToCsv(allRows.slice(0, processedRows), filename);
      log(`Checkpoint saved at row ${processedRows}: ${filename}`);
    }
  }

  const finalFilename = 'updated_citations_final.csv';
  await saveToCsv(allRows, finalFilename);
  log(`Final updated data saved to '${finalFilename}'`);

  await browser.close();
  log('Finished processing all rows. Script complete.');
}

async function saveToCsv(data, filename) {
  const csvWriter = createCsvWriter({
    path: filename,
    header: Object.keys(data[0]).map(id => ({ id, title: id }))
  });

  const allKeys = new Set(data.flatMap(Object.keys));
  const standardizedData = data.map(row => {
    const newRow = {};
    for (const key of allKeys) {
      newRow[key] = row[key] || '';
    }
    return newRow;
  });

  await csvWriter.writeRecords(standardizedData);
  log(`Saved ${standardizedData.length} rows to ${filename}`);
}

main().catch(error => {
  log(`Unhandled error in main function: ${error.message}`);
  process.exit(1);
});