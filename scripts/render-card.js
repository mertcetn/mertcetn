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

async function captureElementGif(element, filenameBase, outDir, frameCount = 25, transparent = false) {
  const frameBuffers = [];

  for (let f = 0; f < frameCount; f++) {
    const buffer = await element.screenshot({ type: 'png', omitBackground: transparent });
    frameBuffers.push(buffer);
    if (frameCount > 1 && f < frameCount - 1) {
      await new Promise(r => setTimeout(r, 100));
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
        delay: 100,
        transparent: transparentIndex !== -1,
        transparentIndex: transparentIndex !== -1 ? transparentIndex : 0
      };
      encoder.writeFrame(index, width, height, options);
    } else {
      const palette = quantize(rgbaData, 256);
      const index = applyPalette(rgbaData, palette);
      encoder.writeFrame(index, width, height, { palette, delay: 100 });
    }
  }
  encoder.finish();

  const gifBuffer = Buffer.from(encoder.bytes());
  const gifPath = path.join(outDir, `${filenameBase}.gif`);
  fs.writeFileSync(gifPath, gifBuffer);

  console.log(`  -> ${filenameBase}.gif (${(gifBuffer.length / 1024).toFixed(1)} KB) & ${filenameBase}.png (${(frameBuffers[0].length / 1024).toFixed(1)} KB)`);
}

async function captureCardWithFrame(page, clip, filenameBase, outDir, frameCount = 25) {
  const frameBuffers = [];
  for (let f = 0; f < frameCount; f++) {
    const buf = await page.screenshot({ type: 'png', clip });
    frameBuffers.push(buf);
    if (f < frameCount - 1) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // Save static PNG (1st frame)
  const pngPath = path.join(outDir, `${filenameBase}.png`);
  fs.writeFileSync(pngPath, frameBuffers[0]);

  // Parse PNGs
  const pngs = frameBuffers.map(b => PNG.sync.read(b));
  const { width, height } = pngs[0];
  const f0 = pngs[0].data;

  // Detect animated pixels (soul fire & pickaxe glint)
  const isAnimated = new Uint8Array(width * height);
  for (let f = 1; f < frameCount; f++) {
    const fd = pngs[f].data;
    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      if (Math.abs(fd[i] - f0[i]) > 5 || Math.abs(fd[i + 1] - f0[i + 1]) > 5 || Math.abs(fd[i + 2] - f0[i + 2]) > 5) {
        isAnimated[p] = 1;
      }
    }
  }

  // Encode GIF with locked static palette indices (100% zero background jitter!)
  const encoder = GIFEncoder();
  const globalPalette = quantize(f0, 256);
  const f0Indices = applyPalette(f0, globalPalette);
  encoder.writeFrame(f0Indices, width, height, { palette: globalPalette, delay: 100 });

  for (let f = 1; f < frameCount; f++) {
    const indices = applyPalette(pngs[f].data, globalPalette);
    for (let p = 0; p < width * height; p++) {
      if (!isAnimated[p]) {
        indices[p] = f0Indices[p];
      }
    }
    encoder.writeFrame(indices, width, height, { palette: globalPalette, delay: 100 });
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

  const xpLevelRegex = /(<div[^>]*mc-level-text[^>]*>)\s*[\s\S]*?\s*(<\/div>)/;
  html = html.replace(xpLevelRegex, `$1${xpInfo.level}$2`);

  const xpFillRegex = /(clip-path:\s*inset\(0\s+)[0-9.]+(%\s+0\s+0\);)/;
  const clipRight = Math.max(0, Math.min(100, 100 - xpInfo.progressPercent)).toFixed(1);
  html = html.replace(xpFillRegex, `$1${clipRight}$2`);

  const xpTextRegex = /--\/--/;
  html = html.replace(xpTextRegex, `Total commits: ${data.totalAllTime} / ${xpInfo.commitsForNextLevel}`);

  // 6b. Hearts & Food Points
  const inactiveDays = data.inactiveDays !== undefined ? data.inactiveDays : 0;
  const foodPoints = data.foodPoints !== undefined ? data.foodPoints : Math.max(0, 20 - inactiveDays);
  const healthPoints = data.healthPoints !== undefined ? data.healthPoints : (inactiveDays <= 20 ? 20 : Math.max(0, 20 - (inactiveDays - 20)));

  console.log(`HUD Status: Inactivity=${inactiveDays}d, Food=${foodPoints / 2}/10, Health=${healthPoints / 2}/10`);

  // Generate 10 Hearts (left-to-right: 0 to 9)
  const heartElements = [];
  for (let i = 0; i < 10; i++) {
    let sprite = 'images/heart_container.png';
    if (healthPoints >= (i + 1) * 2) {
      sprite = 'images/heart_full.png';
    } else if (healthPoints === i * 2 + 1) {
      sprite = 'images/heart_half.png';
    }
    heartElements.push(`                        <img src="${sprite}" class="mc-icon-sprite" alt="Heart" />`);
  }

  const heartsRegex = /<!-- HUD_HEARTS_START -->[\s\S]*?<!-- HUD_HEARTS_END -->/;
  html = html.replace(
    heartsRegex,
    `<!-- HUD_HEARTS_START -->\n                    <div class="flex items-center gap-[3px] mb-[7px]" id="hud-hearts">\n${heartElements.join('\n')}\n                    </div>\n                    <!-- HUD_HEARTS_END -->`
  );

  // Generate 10 Food icons (rendered right-to-left with flex-row-reverse: 0 to 9)
  const foodElements = [];
  for (let i = 0; i < 10; i++) {
    let sprite = 'images/food_empty.png';
    if (foodPoints >= (i + 1) * 2) {
      sprite = 'images/food_full.png';
    } else if (foodPoints === i * 2 + 1) {
      sprite = 'images/food_half.png';
    }
    foodElements.push(`                        <img src="${sprite}" class="mc-icon-sprite" alt="Food" />`);
  }

  const foodRegex = /<!-- HUD_FOOD_START -->[\s\S]*?<!-- HUD_FOOD_END -->/;
  html = html.replace(
    foodRegex,
    `<!-- HUD_FOOD_START -->\n                    <div class="flex items-center gap-[3px] flex-row-reverse mb-[7px]" id="hud-food">\n${foodElements.join('\n')}\n                    </div>\n                    <!-- HUD_FOOD_END -->`
  );

  // 7. Dynamic Hotbar Slots (Top Languages)
  const ICON_MAP = {
    'TypeScript': 'typescript.svg',
    'JavaScript': 'javascript.svg',
    'HTML': 'html5.svg',
    'C#': 'csharp.svg',
    'CSS': 'css3.svg',
    'Java': 'java.svg',
    'Python': 'python.svg'
  };

  if (data.languages && data.languages.length > 0) {
    const hotbarSlots = [];
    let slotIndex = 1;

    for (const lang of data.languages) {
      if (slotIndex > 9) break;
      const icon = ICON_MAP[lang.name];
      if (icon) {
        hotbarSlots.push(`                <!-- Slot ${slotIndex}: ${lang.name} -->
                <div class="mc-slot aspect-square flex items-center justify-center relative group cursor-pointer hover:bg-[#202026] transition-colors"
                    id="hotbar-slot-${slotIndex}" title="${lang.name}: ${lang.exactPercent}%">
                    <img src="images/icons/${icon}" class="w-11 h-11 object-contain pixelated-icon" alt="${lang.name}" />
                    <span class="absolute bottom-1.5 right-2 text-xs md:text-sm font-bold text-white pixel-text-shadow select-none">${Math.max(1, lang.percent)}%</span>
                </div>`);
        slotIndex++;
      }
    }

    while (slotIndex <= 9) {
      hotbarSlots.push(`                <!-- Slot ${slotIndex}: Empty -->
                <div class="mc-slot aspect-square flex items-center justify-center relative group cursor-pointer hover:bg-[#202026] transition-colors"
                    id="hotbar-slot-${slotIndex}">
                </div>`);
      slotIndex++;
    }

    const hotbarRegex = /<!-- HOTBAR_SLOTS_START -->[\s\S]*?<!-- HOTBAR_SLOTS_END -->/;
    html = html.replace(
      hotbarRegex,
      `<!-- HOTBAR_SLOTS_START -->\n${hotbarSlots.join('\n')}\n                <!-- HOTBAR_SLOTS_END -->`
    );
  }

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
    await page.setViewport({ width: 1200, height: 1200, deviceScaleFactor: 1 });

    const fileUrl = 'file://' + previewHtmlPath.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 300));

    const outDir = path.join(__dirname, '../assets/source/generated');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    /*
    // 1. Crafting Log (Animated Soul Fire)
    console.log('Capturing Crafting Log (25 frames)...');
    const craftingLogEl = await page.$('#card-crafting-log');
    if (craftingLogEl) {
      await captureElementGif(craftingLogEl, 'crafting-log', outDir, 25);
    }

    // 2. Total Commits (Animated Netherite Pickaxe Glint)
    console.log('Capturing Total Commits (25 frames)...');
    const totalCommitsEl = await page.$('#card-total-commits');
    if (totalCommitsEl) {
      await captureElementGif(totalCommitsEl, 'total-commits', outDir, 25);
    }

    // 3. Max Streak (Diamond icon)
    console.log('Capturing Max Streak (1 frame)...');
    const maxStreakEl = await page.$('#card-max-streak');
    if (maxStreakEl) {
      await captureElementGif(maxStreakEl, 'max-streak', outDir, 1);
    }

    // 4. XP Bar & Status HUD (Transparent Background, 1 frame static PNG)
    console.log('Capturing XP Bar & Status HUD (Transparent Background)...');
    const xpBarEl = await page.$('#card-xp-bar');
    if (xpBarEl) {
      await page.evaluate(() => {
        document.body.style.background = 'transparent';
        document.body.style.backgroundColor = 'transparent';
        document.body.style.backgroundImage = 'none';
      });
      await captureElementGif(xpBarEl, 'xp-bar', outDir, 1, true);
      // Restore background
      await page.evaluate(() => {
        document.body.style.background = '';
        document.body.style.backgroundColor = '';
        document.body.style.backgroundImage = '';
      });
    }

    // 5. Hotbar (Languages) - Transparent Background
    console.log('Capturing Hotbar (Transparent Background)...');
    const hotbarEl = await page.$('#card-hotbar .mc-panel') || await page.$('#card-hotbar');
    if (hotbarEl) {
      await page.evaluate(() => {
        document.body.style.background = 'transparent';
        document.body.style.backgroundColor = 'transparent';
        document.body.style.backgroundImage = 'none';
      });
      await captureElementGif(hotbarEl, 'hotbar', outDir, 1, true);
      // Restore background for profile-card
      await page.evaluate(() => {
        document.body.style.background = '';
        document.body.style.backgroundColor = '';
        document.body.style.backgroundImage = '';
      });
    }
    */

    // 6. Complete All-In-One Profile Card with Wallpaper Frame & Zero Jitter
    console.log('Capturing Complete Card with Wallpaper Frame & Zero Jitter (25 frames, 10 FPS)...');
    const boardEl = await page.$('#card-capture');
    if (boardEl) {
      const box = await boardEl.boundingBox();
      const pad = 40;
      const clip = {
        x: Math.max(0, box.x - pad),
        y: Math.max(0, box.y - pad),
        width: box.width + pad * 2,
        height: box.height + pad * 2
      };
      await captureCardWithFrame(page, clip, 'profile-card', outDir, 25);
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
