require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const USERNAME = process.env.GH_USERNAME || 'mertcetn';
const START_YEAR = parseInt(process.env.START_YEAR || '2020', 10);

if (!GH_TOKEN) {
  console.error('ERROR: GH_TOKEN or GITHUB_TOKEN environment variable is required.');
  process.exit(1);
}

async function queryGraphQL(query, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `bearer ${GH_TOKEN}`,
          'User-Agent': 'Minecraft-Contributions-Bot',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });

      const json = await res.json();
      if (json.errors) {
        throw new Error(json.errors.map(e => e.message).join(', '));
      }
      return json.data;
    } catch (err) {
      if (attempt < retries) {
        console.warn(`Fetch attempt ${attempt} failed (${err.message}). Retrying in 1.5s...`);
        await new Promise(r => setTimeout(r, 1500));
      } else {
        throw err;
      }
    }
  }
}

async function fetchYearContributions(year) {
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;
  const query = `query {
    user(login: "${USERNAME}") {
      contributionsCollection(from: "${from}", to: "${to}") {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              contributionLevel
              weekday
            }
          }
        }
      }
    }
  }`;

  const data = await queryGraphQL(query);
  return data?.user?.contributionsCollection?.contributionCalendar;
}

async function fetchRollingYearContributions() {
  const query = `query {
    user(login: "${USERNAME}") {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              contributionLevel
              weekday
            }
          }
        }
      }
    }
  }`;

  const data = await queryGraphQL(query);
  return data?.user?.contributionsCollection?.contributionCalendar;
}

async function fetchUserLanguages() {
  const query = `query {
    user(login: "${USERNAME}") {
      repositories(ownerAffiliations: OWNER, first: 100, isFork: false) {
        nodes {
          name
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
    }
  }`;

  const data = await queryGraphQL(query);
  const repos = data?.user?.repositories?.nodes || [];
  const langMap = new Map();
  let totalBytes = 0;

  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      const { name, color } = edge.node;
      const size = edge.size;
      totalBytes += size;
      if (!langMap.has(name)) {
        langMap.set(name, { name, color, size: 0 });
      }
      langMap.get(name).size += size;
    }
  }

  const sorted = Array.from(langMap.values())
    .sort((a, b) => b.size - a.size)
    .map(l => ({
      ...l,
      percent: Math.round((l.size / totalBytes) * 100),
      exactPercent: ((l.size / totalBytes) * 100).toFixed(1)
    }));

  return sorted;
}

async function fetchUserData() {
  const currentYear = new Date().getFullYear();
  let totalAllTime = 0;
  let allDays = [];

  console.log(`Fetching contribution data for @${USERNAME} from ${START_YEAR} to ${currentYear}...`);

  for (let year = START_YEAR; year <= currentYear; year++) {
    const cal = await fetchYearContributions(year);
    const count = cal?.totalContributions || 0;
    totalAllTime += count;
    console.log(`  - Year ${year}: ${count} contributions`);

    if (cal?.weeks) {
      for (const week of cal.weeks) {
        for (const day of week.contributionDays) {
          allDays.push({
            date: day.date,
            count: day.contributionCount,
            level: day.contributionLevel,
            weekday: day.weekday
          });
        }
      }
    }
  }

  // Fetch rolling 1-year calendar for the contribution graph (from 1 year ago today up to today)
  console.log('Fetching rolling 1-year contribution calendar (past 365 days up to today)...');
  const rollingCalendar = await fetchRollingYearContributions();
  const gridWeeks = (rollingCalendar?.weeks || []).slice(-52);
  const lastYearContributions = rollingCalendar?.totalContributions || 0;

  // Remove duplicate dates if any, and sort chronologically
  const dayMap = new Map();
  for (const day of allDays) {
    dayMap.set(day.date, day);
  }
  const sortedDays = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Calculate Streaks
  let maxStreak = 0;
  let runningStreak = 0;

  for (const day of sortedDays) {
    if (day.count > 0) {
      runningStreak++;
      if (runningStreak > maxStreak) {
        maxStreak = runningStreak;
      }
    } else {
      runningStreak = 0;
    }
  }

  // Calculate Current Streak (looking back from today or yesterday)
  const todayStr = new Date().toISOString().split('T')[0];
  let currentStreak = 0;
  
  // Find index of today or latest date
  let lastActiveIdx = -1;
  for (let i = sortedDays.length - 1; i >= 0; i--) {
    if (sortedDays[i].date <= todayStr) {
      lastActiveIdx = i;
      break;
    }
  }

  if (lastActiveIdx !== -1) {
    const lastDay = sortedDays[lastActiveIdx];
    const prevDay = lastActiveIdx > 0 ? sortedDays[lastActiveIdx - 1] : null;

    let startIdx = -1;
    if (lastDay && lastDay.count > 0) {
      startIdx = lastActiveIdx;
    } else if (prevDay && prevDay.count > 0) {
      // If today has no commit yet, streak is still active from yesterday
      startIdx = lastActiveIdx - 1;
    }

    if (startIdx !== -1) {
      for (let i = startIdx; i >= 0; i--) {
        if (sortedDays[i].count > 0) {
          currentStreak++;
        } else {
          break;
        }
      }
    }
  }

  // Find peak day count in the grid to highlight with diamond
  let maxCountInGrid = 0;
  for (const week of gridWeeks) {
    for (const day of week.contributionDays) {
      if (day.contributionCount > maxCountInGrid) {
        maxCountInGrid = day.contributionCount;
      }
    }
  }

  // Calculate Inactive Days (consecutive days without commit, looking back from today)
  let inactiveDays = 0;
  for (let i = sortedDays.length - 1; i >= 0; i--) {
    const day = sortedDays[i];
    if (day.date <= todayStr) {
      if (day.count > 0) {
        break;
      } else {
        inactiveDays++;
      }
    }
  }
  // Calculate Minecraft Health & Hunger Simulation
  // Rules:
  // - Maximum: 20 food points (10 food shanks), 20 health points (10 hearts).
  // - Commit atılan gün (count > 0): tokluk anında fullenir (food = 20).
  // - Tokluk 0 olmadığı sürece her gün yarım kalp (+1 health point, max 20) yenilenir.
  // - Commit atılmayan gün (count === 0):
  //     - Eğer tokluk > 0 ise: yarım yiyecek (-1 food point) eksilir, tokluk bitene kadar can yenilenmeye devam eder.
  //     - Eğer tokluk 0 ise: açlıktan yarım kalp (-1 health point, min 0) can gider.
  let foodPoints = 20;
  let healthPoints = 20;

  for (const day of sortedDays) {
    if (day.date > todayStr) continue;

    if (day.count > 0) {
      foodPoints = 20;
      healthPoints = Math.min(20, healthPoints + 1);
    } else {
      if (foodPoints > 0) {
        foodPoints = Math.max(0, foodPoints - 1);
        healthPoints = Math.min(20, healthPoints + 1);
      } else {
        healthPoints = Math.max(0, healthPoints - 1);
      }
    }
  }

  console.log(`Minecraft HUD Simulation: Food=${foodPoints}/20 (${foodPoints / 2}/10), Health=${healthPoints}/20 (${healthPoints / 2}/10)`);

  // Fetch languages across all user repositories
  console.log('Fetching top repository languages...');
  const languages = await fetchUserLanguages();

  return {
    username: USERNAME,
    totalAllTime,
    lastYearContributions,
    currentStreak,
    maxStreak,
    gridWeeks,
    maxCountInGrid,
    languages,
    inactiveDays,
    foodPoints,
    healthPoints
  };
}

module.exports = { fetchUserData };

if (require.main === module) {
  fetchUserData()
    .then(data => {
      console.log('\n--- FETCH SUMMARY ---');
      console.log('Username:', data.username);
      console.log('All-Time Contributions:', data.totalAllTime);
      console.log('Last Year Contributions:', data.lastYearContributions);
      console.log('Current Streak:', data.currentStreak, 'days');
      console.log('Max Streak:', data.maxStreak, 'days');
      console.log('Weeks for grid:', data.gridWeeks.length);
      console.log('Max count in grid:', data.maxCountInGrid);
    })
    .catch(console.error);
}
