// Generate 52 weeks x 7 days = 364 tiles with varied Minecraft tiers
const gridEl = document.getElementById('commit-grid');
const tooltip = document.getElementById('mc-tooltip');
const tooltipTitle = document.getElementById('tooltip-title');
const tooltipDesc = document.getElementById('tooltip-desc');
const tooltipSub = document.getElementById('tooltip-sub');
const counterEl = document.getElementById('total-commits-counter');

let totalCommits = 1428;

// Biome mode toggle: 0 = Overworld (Green), 1 = Nether (Crimson/Lava), 2 = End (Ender Purple)
let currentTheme = 'overworld';

const startDate = new Date();
startDate.setDate(startDate.getDate() - 364);

for (let w = 0; w < 52; w++) {
    for (let d = 0; d < 7; d++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + (w * 7 + d));

        // Randomly assign Minecraft commit tiers
        const rand = Math.random();
        let lvl = 'tile-lvl-0';
        let commits = 0;
        let note = "Deepslate Silence (0 Commits)";

        if (rand > 0.88) {
            if (Math.random() > 0.8) {
                lvl = 'tile-diamond';
                commits = Math.floor(Math.random() * 8) + 12;
                note = 'Diamond Ore! Epic Release';
            } else if (Math.random() > 0.7) {
                lvl = 'tile-gold';
                commits = Math.floor(Math.random() * 6) + 8;
                note = 'Gold Ingot! Milestone Pull Request';
            } else {
                lvl = 'tile-lvl-4';
                commits = Math.floor(Math.random() * 6) + 7;
                note = 'Emerald Mastercraft (7-12 commits)';
            }
        } else if (rand > 0.65) {
            lvl = 'tile-lvl-3';
            commits = Math.floor(Math.random() * 3) + 4;
            note = 'Lush Vines Crafting (4-6 commits)';
        } else if (rand > 0.40) {
            lvl = 'tile-lvl-2';
            commits = Math.floor(Math.random() * 2) + 2;
            note = 'Oak Sapling Code (2-3 commits)';
        } else if (rand > 0.22) {
            lvl = 'tile-lvl-1';
            commits = 1;
            note = 'Sprout Work (1 commit)';
        }

        const tile = document.createElement('div');
        tile.className = `pixel-tile ${lvl}`;
        tile.dataset.date = currentDate.toISOString().split('T')[0];
        tile.dataset.commits = commits;
        tile.dataset.note = note;

        // Hover event for authentic Minecraft Tooltip
        tile.addEventListener('mouseenter', (e) => {
            tooltipTitle.textContent = tile.dataset.date;
            tooltipDesc.textContent = tile.dataset.commits > 0 ? `${tile.dataset.commits} commits forged` : `No activity recorded`;
            tooltipSub.textContent = tile.dataset.note;
            tooltip.style.display = 'block';
            positionTooltip(e);
        });

        tile.addEventListener('mousemove', (e) => {
            positionTooltip(e);
        });

        tile.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });

        // Click to "mine" a commit directly
        tile.addEventListener('click', () => {
            mineBlock(tile);
        });

        gridEl.appendChild(tile);
    }
}

function positionTooltip(e) {
    const x = e.pageX + 14;
    const y = e.pageY - 38;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
}

function mineBlock(tile) {
    let cur = parseInt(tile.dataset.commits) || 0;
    cur += 1;
    totalCommits += 1;
    tile.dataset.commits = cur;
    counterEl.textContent = totalCommits.toLocaleString();

    // Bump tier class
    tile.className = 'pixel-tile tile-lvl-4';
    tile.dataset.note = 'Overcharged with XP (+1)';

    // Floating XP popup
    showFloatingText(tile, "+1 XP");
}

function showFloatingText(element, text) {
    const rect = element.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.textContent = text;
    popup.style.position = 'fixed';
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.top - 10}px`;
    popup.style.color = '#55ff55';
    popup.style.fontFamily = "'Press Start 2P', monospace";
    popup.style.fontSize = '10px';
    popup.style.textShadow = '2px 2px 0 #000';
    popup.style.pointerEvents = 'none';
    popup.style.zIndex = '999';
    popup.style.transition = 'all 0.6s ease-out';
    document.body.appendChild(popup);

    setTimeout(() => {
        popup.style.transform = 'translateY(-24px)';
        popup.style.opacity = '0';
    }, 20);

    setTimeout(() => {
        popup.remove();
    }, 700);
}

// Mine commit action button
document.getElementById('mine-commit-btn').addEventListener('click', () => {
    const allTiles = document.querySelectorAll('.pixel-tile');
    const randomTile = allTiles[Math.floor(Math.random() * allTiles.length)];
    mineBlock(randomTile);
});

// Theme toggle (Biomes: Overworld -> Nether -> End)
document.getElementById('toggle-grid-mode').addEventListener('click', () => {
    const r = document.documentElement;
    if (currentTheme === 'overworld') {
        currentTheme = 'nether';
        r.style.setProperty('--mc-lvl-1', '#4d1919');
        r.style.setProperty('--mc-lvl-2', '#8c2828');
        r.style.setProperty('--mc-lvl-3', '#d94343');
        r.style.setProperty('--mc-lvl-4', '#ff8533');
    } else if (currentTheme === 'nether') {
        currentTheme = 'end';
        r.style.setProperty('--mc-lvl-1', '#231438');
        r.style.setProperty('--mc-lvl-2', '#492275');
        r.style.setProperty('--mc-lvl-3', '#893ecc');
        r.style.setProperty('--mc-lvl-4', '#d284ff');
    } else {
        currentTheme = 'overworld';
        r.style.setProperty('--mc-lvl-1', '#2d5a27');
        r.style.setProperty('--mc-lvl-2', '#438e38');
        r.style.setProperty('--mc-lvl-3', '#58be49');
        r.style.setProperty('--mc-lvl-4', '#55ff55');
    }
});
