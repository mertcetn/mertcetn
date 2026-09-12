require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { fetchUserData } = require('./fetch-data');

// Quadratic curve fitting: (0, 0), (10, 50), (30, 300)
// C(L) = 0.25 * L^2 + 2.5 * L
// L(C) = sqrt(25 + 4 * C) - 5
function calculateMinecraftCurveLevel(totalCommits) {
  if (!totalCommits || totalCommits <= 0) {
    return {
      level: 0,
      progressInThisLevel: 0,
      neededInThisLevel: 3,
      progressPercent: 0
    };
  }

  const exactLevel = Math.sqrt(25 + 4 * totalCommits) - 5;
  const level = Math.floor(exactLevel);

  const commitsForCurrentLevel = Math.round(0.25 * level * level + 2.5 * level);
  const commitsForNextLevel = Math.round(0.25 * (level + 1) * (level + 1) + 2.5 * (level + 1));

  const neededInThisLevel = commitsForNextLevel - commitsForCurrentLevel;
  const progressInThisLevel = totalCommits - commitsForCurrentLevel;
  const progressPercent = Math.min(100, Math.max(5, Math.round((progressInThisLevel / neededInThisLevel) * 100)));

  return {
    level,
    progressInThisLevel,
    neededInThisLevel,
    progressPercent,
    commitsForCurrentLevel,
    commitsForNextLevel
  };
}

async function captureElementGif(element, filenameBase, outDir, frameCount = 32, transparent = false) {
  const frameBuffers = [];

  for (let f = 0; f < frameCount; f++) {
    const buffer = await element.screenshot({ type: 'png', omitBackground: transparent });
    frameBuffers.push(buffer);
    if (frameCount > 1 && f < frameCount - 1) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  // Save static PNG (1st frame)
  const pngPath = path.join(outDir, `${filenameBase}.png`);
  fs.writeFileSync(pngPath, frameBuffers[0]);

  // Encode GIF
  const encoder = GIFEncoder();
  for (let i = 0; i < frameBuffers.length; i++) {
    const png = PNG.sync.read(frameBuffers[i]);
    const { width, height, data: rgbaData } = png;

    if (transparent) {
      const palette = quantize(rgbaData, 256, { oneBitAlpha: true });
      const index = applyPalette(rgbaData, palette);
      const transparentIndex = palette.findIndex(color => color[3] === 0);
      const options = {
        palette,
        delay: 50,
        transparent: transparentIndex !== -1,
        transparentIndex: transparentIndex !== -1 ? transparentIndex : 0
      };
      encoder.writeFrame(index, width, height, options);
    } else {
      const palette = quantize(rgbaData, 256);
      const index = applyPalette(rgbaData, palette);
      encoder.writeFrame(index, width, height, { palette, delay: 50 });
    }
  }
  encoder.finish();

  const gifBuffer = Buffer.from(encoder.bytes());
  const gifPath = path.join(outDir, `${filenameBase}.gif`);
  fs.writeFileSync(gifPath, gifBuffer);

  console.log(`  -> ${filenameBase}.gif (${(gifBuffer.length / 1024).toFixed(1)} KB) & ${filenameBase}.png (${(frameBuffers[0].length / 1024).toFixed(1)} KB)`);
}

async function generateCard() {
  console.log('--- Step 1: Fetching live GitHub data ---');
  const data = await fetchUserData();

  console.log('--- Step 2: Preparing HTML template ---');
  const templatePath = path.join(__dirname, '../assets/source/index.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  // 1. Subtitle (Blocks forged in last 365 days)
  const subtitleRegex = /<p class="text-\[11px\] text-\[#9ca3af\] mt-1 font-sans font-semibold">[\s\S]*?<\/p>/;
  html = html.replace(
    subtitleRegex,
    `<p class="text-[11px] text-[#9ca3af] mt-1 font-sans font-semibold">${data.lastYearContributions.toLocaleString('en-US')} blocks forged in the last 365 in-game days</p>`
  );

  // 2. Generate 52 weeks grid tiles (52 cols x 7 rows = 364 tiles)
  const tileElements = [];
  const weeks = data.gridWeeks.slice(-52);

  for (const week of weeks) {
    const daysByWeekday = new Map();
    for (const day of week.contributionDays) {
      daysByWeekday.set(day.weekday, day);
    }

    for (let w = 0; w < 7; w++) {
      const day = daysByWeekday.get(w);
      if (!day || day.contributionCount === 0) {
        tileElements.push('                    <div class="pixel-tile tile-lvl-0"></div>');
      } else {
        let levelClass = 'tile-lvl-1';
        if (day.contributionCount >= data.maxCountInGrid && day.contributionCount >= 4) {
          levelClass = 'tile-diamond';
        } else {
          switch (day.contributionLevel) {
            case 'FIRST_QUARTILE':
              levelClass = 'tile-lvl-1';
              break;
            case 'SECOND_QUARTILE':
              levelClass = 'tile-lvl-2';
              break;
            case 'THIRD_QUARTILE':
              levelClass = 'tile-lvl-3';
              break;
            case 'FOURTH_QUARTILE':
              levelClass = 'tile-lvl-4';
              break;
            default:
              levelClass = day.contributionCount > 5 ? 'tile-lvl-4' : day.contributionCount > 2 ? 'tile-lvl-3' : 'tile-lvl-2';
          }
        }
        tileElements.push(`                    <div class="pixel-tile ${levelClass}"></div>`);
      }
    }
  }

  const markerRegex = /<!-- GRID_TILES_START -->[\s\S]*?<!-- GRID_TILES_END -->/;
  html = html.replace(
    markerRegex,
    `<!-- GRID_TILES_START -->\n${tileElements.join('\n')}\n                    <!-- GRID_TILES_END -->`
  );

  // 2b. Dynamic Month Labels for the rolling 52 weeks
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthSpans = [];
  let prevMonth = -1;
  for (const week of weeks) {
    if (week.contributionDays && week.contributionDays.length > 0) {
      const d = new Date(week.contributionDays[0].date + 'T00:00:00Z');
      const m = d.getUTCMonth();
      if (m !== prevMonth) {
        monthSpans.push(`<span>${monthNames[m]}</span>`);
        prevMonth = m;
      }
    }
  }

  const monthRegex = /<!-- MONTH_LABELS_START -->[\s\S]*?<!-- MONTH_LABELS_END -->/;
  html = html.replace(
    monthRegex,
    `<!-- MONTH_LABELS_START -->\n                ${monthSpans.join('')}\n                <!-- MONTH_LABELS_END -->`
  );

  // 3. Current Streak
  const currentStreakRegex = /(CURRENT STREAK:\s*<strong class="text-\[#55ffff\]">).*?(<\/strong>)/;
  html = html.replace(currentStreakRegex, `$1${data.currentStreak} ${data.currentStreak === 1 ? 'DAY' : 'DAYS'}$2`);

  // 4. Total Commits
  const totalCommitsRegex = /(TOTAL COMMITS\s*<\/div>\s*<div class="text-xs sm:text-sm text-\[#ffffff\] font-extrabold mt-1">).*?(<\/div>)/;
  html = html.replace(totalCommitsRegex, `$1${data.totalAllTime.toLocaleString('en-US')}$2`);

  // 5. Max Streak
  const maxStreakRegex = /(MAX STREAK\s*<\/div>\s*<div class="text-xs sm:text-sm text-\[#55ffff\] font-extrabold mt-1">).*?(<\/div>)/;
  html = html.replace(maxStreakRegex, `$1${data.maxStreak} ${data.maxStreak === 1 ? 'DAY' : 'DAYS'}$2`);

  // 6. Experience Bar with Quadratic Curve Level Calculation
  const xpInfo = calculateMinecraftCurveLevel(data.totalAllTime);
  console.log(`Calculated XP Level: LEVEL ${xpInfo.level} (Progress: ${xpInfo.progressInThisLevel}/${xpInfo.neededInThisLevel} commits - ${xpInfo.progressPercent}%)`);

  const xpLevelRegex = /(<div class="text-\[#80ff00\][^>]*pixel-text-shadow">).*?(<\/div>)/;
  html = html.replace(xpLevelRegex, `$1${xpInfo.level}$2`);

  const xpFillRegex = /(clip-path:\s*inset\(0\s+)[0-9.]+(%\s+0\s+0\);)/;
  const clipRight = Math.max(0, Math.min(100, 100 - xpInfo.progressPercent)).toFixed(1);
  html = html.replace(xpFillRegex, `$1${clipRight}$2`);

  const xpTextRegex = /--\/--/;
  html = html.replace(xpTextRegex, `${data.totalAllTime} / ${xpInfo.commitsForNextLevel}`);

  // Save preview HTML
  const previewHtmlPath = path.join(__dirname, '../assets/source/card_preview.html');
  fs.writeFileSync(previewHtmlPath, html, 'utf8');

  console.log('--- Step 3: Launching Puppeteer for Modular Capture ---');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 950, deviceScaleFactor: 1 });

    const fileUrl = 'file://' + previewHtmlPath.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 300));

    const outDir = path.join(__dirname, '../assets');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // 1. Crafting Log (Animated Soul Fire)
    console.log('Capturing Crafting Log (32 frames)...');
    const craftingLogEl = await page.$('#card-crafting-log');
    if (craftingLogEl) {
      await captureElementGif(craftingLogEl, 'crafting-log', outDir, 32);
    }

    // 2. Total Commits (Animated Netherite Pickaxe Glint)
    console.log('Capturing Total Commits (32 frames)...');
    const totalCommitsEl = await page.$('#card-total-commits');
    if (totalCommitsEl) {
      await captureElementGif(totalCommitsEl, 'total-commits', outDir, 32);
    }

    // 3. Max Streak (Diamond icon)
    console.log('Capturing Max Streak (1 frame)...');
    const maxStreakEl = await page.$('#card-max-streak');
    if (maxStreakEl) {
      await captureElementGif(maxStreakEl, 'max-streak', outDir, 1);
    }

    // 4. XP Bar (Transparent Background)
    console.log('Capturing XP Bar (Transparent Background)...');
    const xpBarEl = await page.$('#card-xp-bar');
    if (xpBarEl) {
      await page.evaluate(() => {
        document.body.style.background = 'transparent';
        document.body.style.backgroundColor = 'transparent';
        document.body.style.backgroundImage = 'none';
      });
      await captureElementGif(xpBarEl, 'xp-bar', outDir, 1, true);
      // Restore background for profile-card
      await page.evaluate(() => {
        document.body.style.background = '';
        document.body.style.backgroundColor = '';
        document.body.style.backgroundImage = '';
      });
    }

    // 5. Complete All-In-One Profile Card
    console.log('Capturing Complete Card (32 frames)...');
    const boardEl = await page.$('#card-capture');
    if (boardEl) {
      await captureElementGif(boardEl, 'profile-card', outDir, 32);
    }

    console.log('--- All Modular GIF/PNG Assets Generated Successfully! ---');
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  generateCard().catch(err => {
    console.error('Fatal error during card generation:', err);
    process.exit(1);
  });
}

module.exports = { generateCard, calculateMinecraftCurveLevel };
