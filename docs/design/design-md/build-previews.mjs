// Smart Kitchen design kit: generates preview.html and preview-dark.html.
// Run from this folder:  node build-previews.mjs
// Light values are copied from the v6 prototype (:root and stylesheet). Dark values are DERIVED
// (reference rendering only, the app ships no dark mode); every derivation is listed with its light source.
// The script also measures every text pair on the dark page (WCAG 2.x) and writes the list into preview-dark.html
// and into dark-contrast.json (read by the handoff report).
import { writeFileSync } from 'node:fs';

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => t * v + (1 - t) * B[i])); };
const lin = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = h => { const [r, g, b] = hex2rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ---------- tokens ----------
const L = { paper: '#fbfaf6', tile: '#f1eee6', ink: '#0f0f0f', ink2: '#5f5d58', ink3: '#6f6c66', hair: '#dcd8cf',
  danger: '#882020', dangerBg: '#f9d9d9', amber: '#925b0a', amberBg: '#f6e6c8', green: '#2c744b', greenBg: '#dfeee3',
  rose: '#9d4b51', roseBg: '#f7dcdc', ai: '#7b4cb5', aiBg: '#eadff7', aiInk: '#5a4a70' };
const D = {};
D.paper = '#121212';  // camera surface #121212 (tokens.md section 9 seeds dark paper from it)
D.tile = '#2b2a27';   // camera gradient top stop
D.ink = '#f3f1ec';    // camera text
D.ink2 = '#d9d6cf';   // camera muted text
D.ink3 = '#9a978f';   // prototype stage dashed border literal
D.hair = mix(D.ink, D.paper, 0.2); // ink at 20% over dark paper
const SURF = 0.3;     // semantic dark surface = light hue at 30% over dark paper
for (const k of ['danger', 'amber', 'green', 'rose', 'ai']) {
  D[k] = L[k + 'Bg'];                     // dark text = the light tint
  D[k + 'Bg'] = mix(L[k], D.paper, SURF); // dark surface = the light hue sunk into dark paper
}
D.aiInk = mix(L.aiBg, D.aiBg, 0.8);
// literals the prototype hard-codes: [light, dark]
const LIT = {
  onInk: ['#ffffff', D.paper], inkHover: ['#2b2b2b', '#e4e1d9'], rowHover: ['#f4f2ec', mix(D.ink, D.paper, 0.06)],
  amberInk: ['#5b4210', mix(L.amberBg, D.amberBg, 0.82)], greenInk: ['#1f4d33', mix(L.greenBg, D.greenBg, 0.82)],
  greenHover: ['#235f3d', '#235f3d'], aiHair: ['#d7c6ee', mix(D.ink, D.aiBg, 0.2)], aiTile: ['#f5f0fb', mix(D.ink, D.aiBg, 0.08)],
  focus: ['#2442d6', '#f3f1ec'], dangerSolid: ['#882020', '#882020'], greenSolid: ['#2c744b', '#2c744b'], onSolid: ['#ffffff', '#ffffff'],
};

// name, css var, tokens.ts name (v5 today to v6 per tokens.md section 11), role, key
const TOKENS = [
  ['paper', '--paper', 'paper (value changes in M3-T13)', 'Page canvas, sheet and nav surface', 'paper'],
  ['tile', '--tile', 'sand2 to tile', 'Quiet panel, photo-tile backing, neutral chip', 'tile'],
  ['ink', '--ink', 'ink', 'Text, rules and the primary action fill', 'ink'],
  ['ink2', '--ink2', 'ink2', 'Secondary text', 'ink2'],
  ['ink3', '--ink3', 'ink3', 'Tertiary text on paper and tile only', 'ink3'],
  ['hair', '--hair', 'line to hair', 'Hairline row divider', 'hair'],
  ['danger', '--danger', 'danger', 'Allergen only: text, border and solid fill', 'danger'],
  ['danger-bg', '--danger-bg', 'dangerBg', 'Allergen tint surface', 'dangerBg'],
  ['amber', '--amber', 'amber', 'Estimated, expiring soon, short, data incomplete', 'amber'],
  ['amber-bg', '--amber-bg', 'amberBg', 'Amber tint surface', 'amberBg'],
  ['green', '--green', 'green', 'Known fact, have, fresh, positive', 'green'],
  ['green-bg', '--green-bg', 'greenBg', 'Green tint surface', 'greenBg'],
  ['rose', '--rose', 'rose', 'Use today (never allergen)', 'rose'],
  ['rose-bg', '--rose-bg', 'roseBg', 'Rose tint surface', 'roseBg'],
  ['ai', '--ai', 'ai', 'AI-read items only', 'ai'],
  ['ai-bg', '--ai-bg', 'aiBg', 'AI tint surface and confirmation tray', 'aiBg'],
  ['ai-ink', '--ai-ink', 'aiInk (new in v6)', 'Secondary text on the AI tray', 'aiInk'],
];
const DARKRULE = {
  paper: 'light paper; camera surface #121212', tile: 'light tile; camera gradient top stop #2b2a27', ink: 'light ink; camera text #f3f1ec',
  ink2: 'light ink2; camera muted text #d9d6cf', ink3: 'light ink3; stage dashed border #9a978f', hair: 'light hair; ink at 20% over dark paper',
  danger: 'light danger; the light danger-bg tint becomes the text', dangerBg: 'light danger; hue at 30% over dark paper',
  amber: 'light amber; light amber-bg becomes the text', amberBg: 'light amber; hue at 30% over dark paper',
  green: 'light green; light green-bg becomes the text', greenBg: 'light green; hue at 30% over dark paper',
  rose: 'light rose; light rose-bg becomes the text', roseBg: 'light rose; hue at 30% over dark paper',
  ai: 'light ai; light ai-bg becomes the text', aiBg: 'light ai; hue at 30% over dark paper', aiInk: 'light ai-ink; light ai-bg at 80% over dark ai-bg',
};
const LITERALS = [
  ['on-ink', '--on-ink', 'Text on ink fills', 'onInk'],
  ['ink-hover', '--ink-hover', 'Hover fill of ink buttons', 'inkHover'],
  ['row-hover', '--row-hover', 'Hover fill of list rows', 'rowHover'],
  ['amber-ink', '--amber-ink', 'Body text on amber tint', 'amberInk'],
  ['green-ink', '--green-ink', 'Body text on green tint (pantry banner)', 'greenInk'],
  ['green-hover', '--green-hover', 'Hover fill of the green Add button', 'greenHover'],
  ['ai-hair', '--ai-hair', 'Divider inside the AI tray', 'aiHair'],
  ['ai-tile', '--ai-tile', 'Thumbnail backing in the AI tray', 'aiTile'],
  ['focus', '--focus', 'Keyboard focus ring', 'focus'],
  ['danger-solid', '--danger-solid', 'Solid allergen fills (selected severity button, warning disc)', 'dangerSolid'],
  ['green-solid', '--green-solid', 'The pantry banner Add button fill (the one green action)', 'greenSolid'],
  ['on-solid', '--on-solid', 'Text on the two solid fills above', 'onSolid'],
];
const LITDARKRULE = {
  onInk: 'dark paper (label on a light ink fill)', inkHover: 'invHover #e4e1d9, the prototype inverse-button hover', rowHover: 'ink at 6% over dark paper',
  amberInk: 'light amber-bg at 82% over dark amber-bg', greenInk: 'light green-bg at 82% over dark green-bg', greenHover: 'unchanged',
  aiHair: 'ink at 20% over dark ai-bg', aiTile: 'ink at 8% over dark ai-bg', focus: 'cameraText #f3f1ec, the T8 camera ring', dangerSolid: 'unchanged (safety colour keeps its value)',
  greenSolid: 'unchanged', onSolid: 'unchanged',
};

// ---------- type scale (verified against the v6 CSS) ----------
const DISPLAY = [ // size, lh, ls, role, selector
  [54, 1, '0', 'Initial on a letter tile', '.ph.lettr'], [46, 1, '0', 'Item quantity', '.qtybig b'], [44, 1, '-.015em', 'Screen title', '.title'],
  [40, 1.02, '-.015em', 'Home headline, recipe name', '.h1'], [36, 1, '0', 'Stat value', '.stats .v'], [30, 1.05, '0', 'Scanned product name, camera-denied heading', '.pname, .denied h2'],
  [28, 1, '0', 'Coverage badge on hero, rank numeral, empty-state heading', '.hero .pct, .row .ix, .emptyst h2'], [27, 1.05, '0', 'Recipe card name', '.rec h2'],
  [26, 1, '0', 'Coverage badge on cards, stepper value', '.rec .pct, .step b'], [26, 1.05, '0', 'Sheet title', '.sheet h2'], [25, 1, '0', 'Section heading', '.sec h2'],
  [24, 1, '0', 'Macro value', '.macros b'], [22, 1, '0', 'Group heading, menu-card heading', '.grp h2, .mh h3'], [20, 1, '0', 'Rail badge, picker percentage, initials', '.rph .pct, .pick .pp'],
];
const UI = [ // size, weight, lh, role, selector
  [20, 600, '1', 'Stepper glyph', '.step button'], [17, 700, '1.2', 'Primary block title', '.addprimary b'], [16, 500, '1', 'Text input', '.inp'], [16, 700, '1.2', 'Profile name', '.me b'],
  [15.5, 700, '1.2', 'Row title', '.row b, .arow b'], [15, 400, '1.45', 'Body default', 'body'], [15, 700, '1.2', 'Shopping row title, box heading', '.srow b, .bh, .tastes b'],
  [14.5, 700, '1.25', 'Tray item, ledger title, slot title', '.tray b, .led .m b, .slot .m b'], [14.5, 600, '1.2', 'Picker row, none-option', '.pick, .noneopt'],
  [14, 700, '1', 'Button', '.btn'], [14, 600, '1', 'Segment label, amount, unit label', '.seg button, .srow .amt, .unitlbl'],
  [14, 400, '1.5', 'Paragraph on empty and camera states, chat bubble', '.emptyst p, .denied p, .bub'],
  [13.5, 600, '1.35', 'Verdict line, block bar, toast, loop banner, chip label', '.verdict, .blockbar, .toast, .loop, .chip'],
  [13, 700, '1', 'Ok button, severity button', '.okb, .sev button'], [13, 400, '1.5', 'Short note, byline, row meta', '.verdict .u, .why, .by, .row .q'],
  [12.5, 400, '1.4', 'Caveat line, note, tray source, ledger detail', '.verdict .c, .note, .tray i, .led .m i'],
  [12, 700, '1', 'Chip, label, status', '.prov, .days, .stat, .kv .k, .fl, .queued, .msrc, .mtag'], [12, 600, '1.2', 'Nav label, caption, group count', '.nav button, .grp span, .macros i, .stats .l'],
];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---------- page ----------
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--paper);color:var(--ink)}
body{font:15px/1.45 'Schibsted Grotesk',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
:focus-visible{outline:2.5px solid var(--focus);outline-offset:2px;border-radius:4px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
.num{font-variant-numeric:tabular-nums lining-nums}
.serif{font-family:'Bodoni Moda',serif;font-optical-sizing:auto;font-weight:500}
code{font:inherit;font-weight:600}
.wrap{max-width:960px;margin:0 auto;padding:24px 20px 56px}
.mast{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.mast .name{font:600 12px/1 'Schibsted Grotesk';letter-spacing:.22em;text-transform:uppercase}
.mast .when{font:500 13px/1 'Schibsted Grotesk';color:var(--ink2)}
.rule{height:1px;background:var(--ink);margin:12px 0 0}
.title{padding-top:12px;font-size:44px;line-height:1;letter-spacing:-.015em}
.sub{padding-top:6px;font:500 13.5px/1.35 'Schibsted Grotesk';color:var(--ink2);max-width:640px}
.notice{margin-top:14px;padding:12px 14px;background:var(--tile);font-size:13px;line-height:1.5;color:var(--ink2)}
.notice b{color:var(--ink)}
.sec{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-top:30px;padding-bottom:6px;border-bottom:1px solid var(--ink)}
.sec h2{font-size:25px;line-height:1}
.sec span{font:600 12px/1 'Schibsted Grotesk';color:var(--ink2)}
.lead{margin-top:10px;font-size:13.5px;line-height:1.5;color:var(--ink2);max-width:680px}
.grp{display:flex;justify-content:space-between;align-items:baseline;margin-top:24px;padding-bottom:6px;border-bottom:1px solid var(--ink)}
.grp h3{font-size:22px;line-height:1;font-weight:500}
.grp span{font:600 12px/1 'Schibsted Grotesk';color:var(--ink2)}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px 12px;margin-top:14px}
.sw .chipbox{height:64px;border:1px solid var(--hair)}
.sw b{display:block;margin-top:6px;font:700 14px/1.2 'Schibsted Grotesk'}
.sw .hex{font:600 12.5px/1.3 'Schibsted Grotesk';color:var(--ink)}
.sw .meta{font:400 12.5px/1.35 'Schibsted Grotesk';color:var(--ink2);margin-top:2px}
.tscale{margin-top:10px}
.trow{display:grid;grid-template-columns:190px 1fr;gap:6px 16px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--hair)}
.trow .spec{font:600 12px/1.5 'Schibsted Grotesk';color:var(--ink2)}
.trow .spec i{display:block;font-style:normal;font-weight:400;font-size:12.5px;line-height:1.5;margin-top:2px}
.trow .sample{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.demo{max-width:390px;background:var(--paper);min-width:0}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:6px}
.btns{display:flex;gap:8px;margin-top:14px}
.btn{flex:1;min-height:50px;font:700 14px/1 'Schibsted Grotesk';border:1.5px solid var(--ink);border-radius:999px;padding:0 12px}
.btn.pri{background:var(--ink);color:var(--on-ink)}
.btn:active{transform:scale(.98)}
.okb{min-height:44px;min-width:56px;padding:0 14px;border-radius:999px;font:700 13px/1 'Schibsted Grotesk';background:var(--ink);color:var(--on-ink)}
.okb.ghost{background:transparent;color:var(--ink);border:1.5px solid var(--ink)}
.row2{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
.chip{flex:0 0 auto;display:inline-flex;align-items:center;min-height:40px;padding:0 15px;border-radius:999px;border:1.5px solid var(--ink);font:600 13.5px/1 'Schibsted Grotesk'}
.chip.is-on{background:var(--ink);color:var(--on-ink)}
.chip.alg-on{border-color:var(--danger);background:var(--danger-bg);color:var(--danger)}
.sevbtn{display:inline-flex;align-items:center;min-height:40px;padding:0 13px;border-radius:999px;border:1.5px solid var(--ink);font:600 13px/1 'Schibsted Grotesk'}
.sevbtn.alg-on{background:var(--danger-solid);color:var(--on-solid);border-color:var(--danger-solid)}
.days{font:700 12px/1 'Schibsted Grotesk';letter-spacing:.12em;text-transform:uppercase;padding:6px 8px;border-radius:999px;white-space:nowrap}
.days.now{background:var(--rose-bg);color:var(--rose)}
.days.soon{background:var(--amber-bg);color:var(--amber)}
.days.ok{background:var(--green-bg);color:var(--green)}
.prov{font-size:12px;font-weight:700;padding:4px 9px;border-radius:999px;white-space:nowrap}
.prov.fact{color:var(--green);background:var(--green-bg)}
.prov.est{color:var(--amber);background:var(--amber-bg)}
.prov.ai{color:var(--ai);background:var(--ai-bg)}
.prov.alg{color:var(--danger);background:var(--danger-bg);display:inline-flex;gap:4px;align-items:center}
.stat{font:700 12px/1 'Schibsted Grotesk';letter-spacing:.1em;text-transform:uppercase;padding:6px 8px;border-radius:999px;white-space:nowrap}
.stat.have{background:var(--green-bg);color:var(--green)}
.stat.shortby{background:var(--amber-bg);color:var(--amber)}
.stat.list{background:var(--tile);color:var(--ink2)}
.stat.staple{background:transparent;color:var(--ink3);border:1px solid var(--hair)}
.msrc{font:700 12px/1 'Schibsted Grotesk';letter-spacing:.08em;text-transform:uppercase;padding:3px 6px;background:var(--tile);margin-right:4px}
.verdict{font-size:13.5px;line-height:1.4;margin-top:14px}
.verdict .l{display:flex;gap:7px;align-items:flex-start;font-weight:600}
.verdict .l svg{flex:0 0 auto;margin-top:2px}
.verdict .u{font-size:13px;margin-top:3px;padding-left:22px}
.verdict .c{font-size:12.5px;color:var(--ink2);margin-top:3px;padding-left:22px}
.verdict.ok{border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);padding:10px 0}
.verdict.unk{color:var(--amber);background:var(--amber-bg);padding:11px 12px;border-radius:10px}
.verdict.unk .c,.verdict.unk .u{color:var(--amber-ink)}
.blockbar{display:flex;gap:9px;align-items:flex-start;background:var(--danger-bg);color:var(--danger);border:1.5px solid var(--danger);border-radius:10px;padding:11px 12px;font-size:13.5px;font-weight:600;line-height:1.35;margin-top:14px}
.blockbar .sh{flex:0 0 24px;height:24px;border-radius:50%;background:var(--danger-solid);display:grid;place-items:center}
.note{font-size:12.5px;line-height:1.45;color:var(--ink2);margin-top:8px}
.list{margin-top:6px}
.row{display:grid;grid-template-columns:56px 1fr auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--hair);min-height:72px;width:100%;text-align:left}
.row .th{width:56px;height:56px;background:var(--tile);display:grid;place-items:center;font:500 28px/1 'Bodoni Moda';color:var(--ink3)}
.row b{font:700 15.5px/1.2 'Schibsted Grotesk';display:block}
.row .q{font:400 13px/1.3 'Schibsted Grotesk';color:var(--ink2);display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:3px}
.srow{display:grid;grid-template-columns:44px 48px 1fr auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--hair);min-height:68px}
.chk{width:44px;height:44px;display:grid;place-items:center}
.chk span{width:26px;height:26px;border:1.75px solid var(--ink);border-radius:50%;display:grid;place-items:center}
.srow .th{width:48px;height:48px;background:var(--tile);display:grid;place-items:center;font:500 24px/1 'Bodoni Moda';color:var(--ink3)}
.srow b{font:700 15px/1.2 'Schibsted Grotesk';display:block}
.srow .s{font:400 12.5px/1.35 'Schibsted Grotesk';color:var(--ink2);margin-top:2px}
.srow .amt{font:600 14px/1 'Schibsted Grotesk';text-align:right}
.stats{margin-top:24px;display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--ink);border-bottom:1px solid var(--ink)}
.stats div{padding:12px 10px 12px 10px;border-right:1px solid var(--hair);min-height:72px}
.stats div:first-child{padding-left:0}
.stats div:last-child{border-right:0}
.stats .v{display:block;font:500 36px/1 'Bodoni Moda';font-variant-numeric:tabular-nums lining-nums}
.stats .v,.stats .l{width:fit-content}
.stats .l{display:block;font:600 12px/1.2 'Schibsted Grotesk';color:var(--ink2);margin-top:4px}
.loop{margin-top:14px;padding:12px 14px;background:var(--green-bg);color:var(--green-ink);display:flex;gap:10px;align-items:center;justify-content:space-between;font:600 13.5px/1.35 'Schibsted Grotesk'}
.loop .okb{background:var(--green-solid);color:var(--on-solid);flex:0 0 auto}
.tray{margin-top:12px;padding:4px 14px;background:var(--ai-bg);border-radius:14px}
.tray .trh{display:flex;justify-content:space-between;align-items:center;padding:10px 0 4px;color:var(--ai);font:700 13.5px/1 'Schibsted Grotesk'}
.tray .trh b{display:flex;gap:6px;align-items:center;font:inherit}
.tray .ci{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--ai-hair)}
.tray .ci .th{width:44px;height:44px;flex:0 0 44px;background:var(--ai-tile);display:grid;place-items:center;font:500 22px/1 'Bodoni Moda';color:var(--ai-ink)}
.tray .m{flex:1;min-width:0}
.tray .m b{font:700 14.5px/1.25 'Schibsted Grotesk';display:block}
.tray i{font-style:normal;font-size:12.5px;color:var(--ai-ink)}
.tray .foot2{font-size:12.5px;color:var(--ai-ink);padding:8px 0 10px}
.addprimary{display:flex;align-items:center;gap:14px;width:100%;margin-top:20px;padding:18px 16px;min-height:88px;background:var(--ink);color:var(--on-ink);border-radius:14px;text-align:left}
.addprimary b{display:block;font:700 17px/1.2 'Schibsted Grotesk'}
.addprimary .ap{flex:1;min-width:0}
.addprimary .ap span{display:block;font-size:13.5px;line-height:1.4;color:var(--on-ink-muted);margin-top:3px}
.arow{display:flex;align-items:center;gap:14px;width:100%;min-height:68px;padding:12px 0;border-bottom:1px solid var(--hair);text-align:left}
.arow .am{flex:1;min-width:0}
.arow b{display:flex;align-items:center;gap:8px;font:700 15.5px/1.2 'Schibsted Grotesk'}
.arow .am>span{display:block;font-size:13px;line-height:1.4;color:var(--ink2);margin-top:3px}
.arow.soon{color:var(--ink2)}
.arow.soon b{font-weight:600;color:var(--ink2)}
.arow.soon .am>span{color:var(--ink3)}
.field{margin-top:22px}
.fl{display:flex;justify-content:space-between;align-items:center;font:700 12px/1 'Schibsted Grotesk';letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
.inp{width:100%;height:50px;margin-top:8px;border:0;border-bottom:1.5px solid var(--ink);background:transparent;font:500 16px/1 'Schibsted Grotesk';color:var(--ink);padding:0 2px}
.inp::placeholder{color:var(--ink3)}
.nav{display:grid;grid-template-columns:repeat(5,1fr);align-items:center;background:var(--paper);border-top:1px solid var(--ink);padding:8px 8px 20px;margin-top:20px}
.nav button{display:flex;flex-direction:column;align-items:center;gap:5px;font:600 12px/1 'Schibsted Grotesk';color:var(--ink2);min-height:48px;justify-content:center}
.nav button[aria-current=page]{color:var(--ink);font-weight:800}
.nav button[aria-current=page] svg{stroke-width:2.3}
.nav .add{gap:4px}
.nav .add .disc{width:46px;height:46px;border-radius:50%;background:var(--ink);color:var(--on-ink);display:grid;place-items:center}
.sheetdemo{margin-top:14px;background:var(--tile);padding-top:36px;position:relative}
.sheetdemo::before{content:"";position:absolute;inset:0;background:var(--scrim)}
.sheet{position:relative;background:var(--paper);border-radius:22px 22px 0 0;padding:20px 20px 28px}
.sheet h2{font-size:26px;line-height:1.05;margin-bottom:12px}
.toast{margin-top:14px;background:var(--ink);color:var(--on-ink);padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.35}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}
.tile{display:flex;flex-direction:column;gap:6px}
.tile .ti{aspect-ratio:1;background:var(--tile);display:grid;place-items:center;font:500 28px/1 'Bodoni Moda';color:var(--ink3)}
.tile .cap{font:500 12px/1.25 'Schibsted Grotesk';color:var(--ink2)}
.tile .cap b{display:block;color:var(--ink);font-weight:700}
.tile.short .ti{background:var(--amber-bg);color:var(--amber)}
.tile.short .cap,.tile.short .cap b{color:var(--amber)}
.hero{position:relative;aspect-ratio:4/3;overflow:hidden;background:var(--tile);margin-top:14px;display:grid;place-items:center;font:500 54px/1 'Bodoni Moda';color:var(--ink3)}
.hero .pct{position:absolute;right:0;bottom:0;background:var(--paper);padding:7px 10px 5px;font:500 28px/1 'Bodoni Moda';color:var(--ink)}
.hero .pct small{font:700 12px/1 'Schibsted Grotesk';letter-spacing:.12em;text-transform:uppercase;margin-left:5px;color:var(--ink2)}
.sp{display:flex;align-items:center;gap:12px;padding:4px 0;font:600 12.5px/1.3 'Schibsted Grotesk';color:var(--ink2)}
.sp .bar{height:12px;background:var(--ink);flex:0 0 auto}
.sp b{color:var(--ink);min-width:44px}
.rads{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px;margin-top:14px}
.rad .box{height:64px;background:var(--tile);border:1.5px solid var(--ink)}
.rad b{display:block;margin-top:6px;font:700 13px/1.2 'Schibsted Grotesk'}
.rad span{font:400 12.5px/1.35 'Schibsted Grotesk';color:var(--ink2)}
.ring{display:inline-block;padding:10px 16px;outline:2.5px solid var(--focus);outline-offset:2px;border-radius:4px;font:600 13px/1 'Schibsted Grotesk'}
.ctable{width:100%;border-collapse:collapse;margin-top:12px;font-size:12.5px;min-width:720px}
.ctable th{font:700 12px/1.2 'Schibsted Grotesk';letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);text-align:left;padding:8px 8px 8px 0;border-bottom:1px solid var(--ink)}
.ctable td{padding:8px 8px 8px 0;border-bottom:1px solid var(--hair);vertical-align:top}
.ctable .flag{font-weight:700;color:var(--amber)}
.tscroll{overflow-x:auto}
.dot{display:inline-block;width:14px;height:14px;border:1px solid var(--hair);vertical-align:-2px;margin-right:6px}
.foot{margin-top:40px;font-size:12.5px;line-height:1.5;color:var(--ink2);max-width:680px}
@media (hover:hover){
  .btn:not(.pri):hover{background:var(--tile)}
  .btn.pri:hover{background:var(--ink-hover)}
  .okb:not(.ghost):hover{background:var(--ink-hover)}
  .okb.ghost:hover{background:var(--tile)}
  .loop .okb:hover{background:var(--green-hover)}
  .arow:not(.soon):hover{background:var(--row-hover)}
  .addprimary:hover{background:var(--ink-hover)}
  .nav button:not(.add):hover{color:var(--ink)}
}
@media (max-width:520px){.title{font-size:40px}.trow{grid-template-columns:1fr}}
::selection{background:var(--sel-bg);color:var(--sel-fg)}
`;

const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-home" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/></symbol>
<symbol id="i-inv" viewBox="0 0 24 24"><path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z"/><path d="M8 9l2.5-5"/><path d="M16 9l-2.5-5"/></symbol>
<symbol id="i-menu" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/></symbol>
<symbol id="i-shop" viewBox="0 0 24 24"><path d="M3 3h2l2.6 12.4a1 1 0 0 0 1 .6h8.7a1 1 0 0 0 1-.8L20 8H6"/><circle cx="9.5" cy="20" r="1"/><circle cx="17" cy="20" r="1"/></symbol>
<symbol id="i-scan" viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.6-3 7.8-7 9-4-1.2-7-4.4-7-9V6z"/></symbol>
<symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 3.5L21.5 20h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.4" r=".6" fill="currentColor"/></symbol>
<symbol id="i-spark" viewBox="0 0 24 24"><path d="M11 4l1.6 4.2L17 9.8l-4.4 1.6L11 16l-1.6-4.6L5 9.8l4.4-1.6z"/></symbol>
<symbol id="i-pen" viewBox="0 0 24 24"><path d="M15.5 4.5l4 4L9 19H5v-4z"/></symbol>
<symbol id="i-receipt" viewBox="0 0 24 24"><path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21z"/><path d="M9 8h6"/><path d="M9 12h6"/></symbol>
</defs></svg>`;
const ico = (id, s = 15, w = 2, extra = '') => `<svg width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${w}" ${extra} aria-hidden="true"><use href="#${id}"/></svg>`;
const ROUND = 'stroke-linecap="round" stroke-linejoin="round"';

function measure() {
  const vals = { ...D, ...Object.fromEntries(Object.entries(LIT).map(([k, v]) => [k, v[1]])) };
  vals.onInkMuted = mix(D.paper, D.ink, 0.78); // rgba(18,18,18,.78) composited over the ink fill
  const pairs = [
    ['ink on paper', 'ink', 'paper', 'body and headings', 4.5], ['ink on tile', 'ink', 'tile', 'neutral panels, stat captions', 4.5],
    ['ink2 on paper', 'ink2', 'paper', 'sub-lines, meta, nav labels, notes', 4.5], ['ink2 on tile', 'ink2', 'tile', 'notice text, .stat.list, tile captions', 4.5],
    ['ink3 on paper', 'ink3', 'paper', 'placeholder, .stat.staple, soon rows', 4.5], ['ink3 on tile', 'ink3', 'tile', 'photo tile initials (24 to 54px Bodoni, large)', 3],
    ['on-ink on ink', 'onInk', 'ink', '.btn.pri, .okb, toast, .addprimary title, nav Add disc', 4.5], ['on-ink 78% on ink (composite)', 'onInkMuted', 'ink', '.addprimary subline', 4.5],
    ['on-ink on ink-hover', 'onInk', 'inkHover', 'hover of ink buttons', 4.5], ['ink on tile (hover)', 'ink', 'tile', 'hover of outlined buttons', 4.5], ['ink on row-hover', 'ink', 'rowHover', 'hover of list rows', 4.5],
    ['danger on danger-bg', 'danger', 'dangerBg', '.blockbar, .prov.alg, selected allergy chip (alert text, 7:1 bar)', 7],
    ['danger on paper', 'danger', 'paper', 'allergen lines drawn on paper (alert text, 7:1 bar)', 7],
    ['on-solid on danger-solid', 'onSolid', 'dangerSolid', 'selected severity button, warning disc glyph', 4.5],
    ['amber on amber-bg', 'amber', 'amberBg', '.verdict.unk, .days.soon, .prov.est, .stat.shortby', 4.5], ['amber-ink on amber-bg', 'amberInk', 'amberBg', '.verdict.unk caveat lines', 4.5],
    ['green on green-bg', 'green', 'greenBg', '.days.ok, .prov.fact, .stat.have', 4.5], ['green-ink on green-bg', 'greenInk', 'greenBg', '.loop banner text', 4.5],
    ['on-solid on green-solid', 'onSolid', 'greenSolid', '.loop .okb Add', 4.5], ['on-solid on green-hover', 'onSolid', 'greenHover', '.loop .okb hover', 4.5],
    ['rose on rose-bg', 'rose', 'roseBg', '.days.now', 4.5], ['ai on ai-bg', 'ai', 'aiBg', '.prov.ai, tray heading', 4.5], ['ai-ink on ai-bg', 'aiInk', 'aiBg', 'tray source and footnote lines', 4.5],
    ['ink on ai-bg', 'ink', 'aiBg', 'tray item names', 4.5], ['ai-ink on ai-tile', 'aiInk', 'aiTile', 'tray thumbnail initial (22px Bodoni, large)', 3],
    ['focus ring on paper', 'focus', 'paper', 'focus ring (non-text)', 3], ['focus ring on tile', 'focus', 'tile', 'focus ring over tile-backed controls (non-text)', 3],
  ];
  return pairs.map(([label, f, b, where, tgt]) => { const r = ratio(vals[f], vals[b]); return { label, fg: vals[f], bg: vals[b], where, tgt, r: +r.toFixed(2), ok: r >= tgt }; });
}
const results = measure();

function page(theme) {
  const dark = theme === 'dark';
  const V = {};
  for (const [, v, , , key] of TOKENS) V[v] = dark ? D[key] : L[key];
  for (const [, v, , key] of LITERALS) V[v] = LIT[key][dark ? 1 : 0];
  V['--on-ink-muted'] = dark ? 'rgba(18,18,18,.78)' : 'rgba(255,255,255,.78)';
  V['--scrim'] = 'rgba(15,15,15,.45)';
  V['--sel-bg'] = dark ? '#f3f1ec' : '#151515'; V['--sel-fg'] = dark ? '#121212' : '#fbfaf6';
  const root = ':root{' + Object.entries(V).map(([k, v]) => `${k}:${v}`).join(';') + '}';

  const swatch = ([name, v, ts, role, key]) => `<div class="sw"><div class="chipbox" style="background:var(${v})"></div><b>${name}</b><div class="hex">${dark ? D[key] : L[key]}</div><div class="meta"><code>${v}</code> · tokens.ts ${esc(ts)}</div><div class="meta">${role}${dark ? `<br>Derived from ${DARKRULE[key]}. Light value ${L[key]}.` : ''}</div></div>`;
  const litSwatch = ([name, v, role, key]) => `<div class="sw"><div class="chipbox" style="background:var(${v})"></div><b>${name}</b><div class="hex">${LIT[key][dark ? 1 : 0]}</div><div class="meta"><code>${v}</code></div><div class="meta">${role}${dark ? `<br>Derived: ${LITDARKRULE[key]}. Light value ${LIT[key][0]}.` : ''}</div></div>`;

  const typeRows = DISPLAY.map(([s, lh, ls, role, sel]) => `<div class="trow"><div class="spec">${s}px · 500 · lh ${lh}${ls !== '0' ? ' · ls ' + ls : ''}<i>${esc(role)} (${esc(sel)})</i></div><div class="sample serif" style="font-size:${s}px;line-height:${lh};${ls !== '0' ? 'letter-spacing:' + ls : ''}">Chicken &amp; spinach</div></div>`).join('')
    + UI.map(([s, w, lh, role, sel]) => `<div class="trow"><div class="spec">${s}px · ${w} · lh ${lh}<i>${esc(role)} (${esc(sel)})</i></div><div class="sample" style="font:${w} ${s}px/${lh} 'Schibsted Grotesk'">Olive oil · 1 bottle · opened Aug 30</div></div>`).join('');

  const spacings = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 30, 40];
  const radii = [['0', 'Photos, tiles, labels (.mtag, .msrc, .tagm)'], ['999px', '.btn, .chip, .okb, .days, .prov, .stat'], ['50%', '.av, .iconb, .chk span, nav Add disc'],
    ['22px 22px 0 0', '.sheet, .panel'], ['14px', '.tray, .addprimary'], ['12px', '.toast'], ['10px', '.verdict.unk, .blockbar'], ['8px', '.verdict.unk.sm'], ['4px', ':focus-visible ring corner']];

  const rows = results.map(x => `<tr><td>${x.label}</td><td><span class="dot" style="background:${x.fg}"></span>${x.fg}</td><td><span class="dot" style="background:${x.bg}"></span>${x.bg}</td><td>${esc(x.where)}</td><td class="num">${x.tgt}</td><td class="num">${x.r.toFixed(2)}</td><td class="${x.ok ? '' : 'flag'}">${x.ok ? 'Pass' : 'FLAG, under ' + x.tgt + ':1'}</td></tr>`).join('');
  const contrastSection = dark ? `
<div class="sec"><h2 class="serif">Measured contrast</h2><span class="num">${results.length} pairs</span></div>
<p class="lead">Every text pair and the focus ring on this page, measured by <code>build-previews.mjs</code> (WCAG 2.x). Targets: 4.5:1 body, 3:1 large text and non-text, 7:1 for allergen alert text (the bar tokens.md section 4 sets). A pair under its target is flagged here and in the handoff report. Nothing is tuned to hide a flag.</p>
<div class="tscroll"><table class="ctable"><thead><tr><th>Pair</th><th>Text</th><th>Surface</th><th>Where</th><th>Target</th><th>Ratio</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';

  const body = `
<div class="wrap">
<div class="mast"><span class="name">Smart Kitchen</span><span class="when">Design kit · v6 Cookbook · ${dark ? 'dark reference' : 'light'}</span></div>
<div class="rule"></div>
<h1 class="title serif">${dark ? 'Token catalog, dark' : 'Token catalog'}</h1>
<p class="sub">Every colour, type size, radius and spacing step of prototype v6, drawn with the prototype's own CSS values.${dark ? '' : ' A dark reference page sits beside this one.'}</p>
${dark ? '<p class="notice"><b>Reference rendering, not a shipped theme.</b> The app ships no dark mode (OQ-D6 is open); every dark value here is derived and listed with its light source.</p>' : ''}

<div class="sec"><h2 class="serif">Colour</h2><span class="num">${TOKENS.length} roles</span></div>
<p class="lead">Allergen red appears only on allergens. The expiry ladder never turns red: rose for today, amber for 2 to 3 days, green after. Amber marks estimates and unknowns. Purple marks AI-read items only. Measured contrast of each pair is in tokens.md section 4${dark ? ' (light) and the measured list at the bottom of this page (dark)' : ''}.</p>
<div class="swatches">${TOKENS.map(swatch).join('')}</div>
<div class="grp"><h3 class="serif">Literals the prototype hard-codes</h3><span class="num">${LITERALS.length}</span></div>
<div class="swatches">${LITERALS.map(litSwatch).join('')}</div>

<div class="sec"><h2 class="serif">Type scale</h2><span class="num">${DISPLAY.length + UI.length} rows</span></div>
<p class="lead">Bodoni Moda 500 for display, Schibsted Grotesk for UI, 12px is the smallest size. Samples render in the real fonts from the same Google Fonts link the prototype uses; offline they fall back to the system serif and sans.</p>
<div class="tscale">${typeRows}</div>

<div class="sec"><h2 class="serif">Buttons, chips, pills</h2></div>
<div class="cols"><div class="demo">
<div class="btns"><button class="btn">Cancel</button><button class="btn pri">Log meal, record deductions</button></div>
<div class="row2"><button class="okb">Yes</button><button class="okb ghost">Edit</button></div>
<div class="row2"><span class="chip">Fridge</span><span class="chip is-on">Weekend</span><span class="chip alg-on">Peanut</span></div>
<div class="row2"><span class="sevbtn">Standard</span><span class="sevbtn alg-on">Severe</span><span class="ring">Focus ring</span></div>
<p class="note">A selected allergen chip is a danger-bg fill with danger text and border; a selected severity button is a solid danger fill with white text (v5 values, D-033 amendment 2026-10-14). Every other selected control is ink. Chips here are static samples; in the app each carries a 44px hit area.</p>
<div class="loop"><span>Olive oil checked off · add it to the pantry?</span><button class="okb">Add</button></div>
<p class="note">The green Add is the only green action in the app.</p>
</div><div class="demo">
<div class="row2" style="margin-top:14px"><span class="days now">Today</span><span class="days soon">2 days</span><span class="days ok">10 days</span></div>
<div class="row2"><span class="prov fact">✓ Fact</span><span class="prov est">≈ Est.</span><span class="prov ai">AI · confirm</span><span class="prov alg">${ico('i-warn', 12, 2.4, 'stroke-linecap="round"')}Allergen</span></div>
<div class="row2"><span class="stat have">have</span><span class="stat shortby num">short 0.75 lb</span><span class="stat list">On list</span><span class="stat staple">not tracked</span></div>
<div class="row2"><span class="msrc">Tonight</span><span class="msrc">Weekend menu</span></div>
<p class="note">Fact, Est. and AI chips go on every fallible fact. Each pairs a glyph or words with its colour, so colour is never the only signal.</p>
</div></div>

<div class="sec"><h2 class="serif">Allergen verdict</h2></div>
<div class="cols"><div class="demo">
<div class="verdict ok"><div class="l">${ico('i-shield')}No known allergen match · 2 members</div><div class="c">Known matches only · not a guarantee this food is safe.</div></div>
<div class="verdict unk"><div class="l">${ico('i-warn', 15, 2.2, 'stroke-linecap="round"')}Allergen data incomplete for Maya</div><div class="u">There's no ingredient list on file to check for Maya's severe sesame allergy.</div><div class="c">Known matches only · not a guarantee this food is safe.</div></div>
</div><div class="demo">
<div class="blockbar"><span class="sh"><svg width="13" height="13" fill="none" stroke="var(--on-solid)" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><use href="#i-warn"/></svg></span>Blocked for Maya</div>
<p class="note">Verdict copy is verbatim from the prototype and copy-deck.md. The deck wins on safety strings.</p>
</div></div>

<div class="sec"><h2 class="serif">Lists, rows, panels</h2></div>
<div class="cols"><div class="demo">
<div class="grp" style="margin-top:14px"><h3 class="serif">Fridge</h3><span class="num">3</span></div>
<div class="list">
<div class="row"><span class="th">C</span><span><b>Chicken breast</b><span class="q num">1.25 lb <span class="days soon">2 days</span></span></span><span class="prov fact">✓ Fact</span></div>
<div class="row"><span class="th">S</span><span><b>Strawberries</b><span class="q num">1 lb <span class="days now">Today</span></span></span><span class="prov ai">AI · confirm</span></div>
<div class="row"><span class="th">B</span><span><b>Basmati rice</b><span class="q num">~4 cups · qty derived from 2 meals</span></span><span class="prov est">≈ Est.</span></div>
</div>
<div class="stats"><div><span class="v">4</span><span class="l">use this week</span></div><div><span class="v">5</span><span class="l">to buy</span></div><div><span class="v">67%</span><span class="l">verified</span></div></div>
</div><div class="demo">
<div class="grp" style="margin-top:14px"><h3 class="serif">Shopping</h3></div>
<div class="srow"><span class="chk"><span></span></span><span class="th">C</span><div><b>Chicken breast</b><div class="s num"><span class="msrc">Tonight</span>need 2 lb · have 1.25 lb</div></div><div class="amt num">0.75 lb</div></div>
<div class="srow"><span class="chk"><span></span></span><span class="th">B</span><div><b>Broccoli</b><div class="s"><span class="msrc">Weekend menu</span>miso salmon · none on hand</div></div><div class="amt num">2 lb</div></div>
<div class="tray"><div class="trh"><b>${ico('i-spark', 14, 2)}Needs your confirmation</b><span class="prov ai">AI read · 2</span></div>
<div class="ci"><span class="th">M</span><span class="m"><b>Mushrooms · 8 oz?</b><i>receipt read "CREMINI MUSHRM 8OZ"</i></span><button class="okb">Yes</button></div>
<div class="foot2">Nothing enters your inventory as fact until you say so.</div></div>
</div></div>

<div class="sec"><h2 class="serif">Photo tiles</h2></div>
<div class="cols"><div class="demo"><div class="tiles"><div class="tile"><span class="ti">C</span><span class="cap num"><b>Chicken</b>1.25 lb</span></div><div class="tile"><span class="ti">S</span><span class="cap num"><b>Spinach</b>5 oz</span></div><div class="tile"><span class="ti">M</span><span class="cap num"><b>Mushrooms</b>8 oz</span></div><div class="tile short"><span class="ti">C</span><span class="cap num"><b>Chicken</b>0.75 lb short</span></div></div>
<p class="note">Square, radius 0. A real photo replaces the initial.</p></div>
<div class="demo"><div class="hero">C<span class="pct num">92<small>% coverage</small></span></div></div></div>

<div class="sec"><h2 class="serif">Add food, input, sheet, tab bar</h2></div>
<div class="cols"><div class="demo">
<button class="addprimary"><span class="ap"><b>Scan barcode</b><span>Product facts fill in from the label database</span></span>${ico('i-scan', 26, 1.9)}</button>
<div style="border-top:1px solid var(--ink);margin-top:14px"><button class="arow">${ico('i-pen', 22, 1.9, ROUND)}<span class="am"><b>Type it in</b><span>Always available, never blocked</span></span></button>
<div class="arow soon">${ico('i-receipt', 22, 1.9, ROUND)}<span class="am"><b>Scan receipt</b><span>One photo adds the whole grocery run</span></span></div></div>
<div class="field"><div class="fl"><span>Name</span></div><input class="inp" aria-label="Name"></div>
</div><div class="demo">
<div class="sheetdemo"><div class="sheet"><h2 class="serif">Cook this · confirm deductions</h2><div class="btns" style="margin-top:0"><button class="btn">Cancel</button><button class="btn pri">Log meal, record deductions</button></div></div></div>
<div class="toast">Olive oil added to Pantry · inventory updated</div>
<nav class="nav" aria-label="Sample tab bar"><button aria-current="page">${ico('i-home', 22, 1.8, ROUND)}Home</button><button>${ico('i-inv', 22, 1.8, ROUND)}Inventory</button><button class="add" aria-label="Add food"><span class="disc">${ico('i-scan', 22, 2, 'stroke-linecap="round"')}</span></button><button>${ico('i-menu', 22, 1.8, ROUND)}Menu</button><button>${ico('i-shop', 22, 1.8, ROUND)}Shopping</button></nav>
</div></div>

<div class="sec"><h2 class="serif">Spacing</h2><span class="num">${spacings.length} values</span></div>
<p class="lead">Measured from the stylesheet's padding, margin and gap declarations. 20px is the screen gutter. Bars are drawn at 4x.</p>
<div style="margin-top:10px">${spacings.map(s => `<div class="sp"><b class="num">${s}px</b><span class="bar" style="width:${s * 4}px"></span>${s === 20 ? 'gutter' : ''}</div>`).join('')}</div>
<div class="sec"><h2 class="serif">Radius</h2><span class="num">${radii.length} values</span></div>
<div class="rads">${radii.map(([v, w]) => `<div class="rad"><div class="box" style="border-radius:${v}"></div><b>${v}</b><span>${esc(w)}</span></div>`).join('')}</div>
${contrastSection}
<p class="foot">Source: <code>docs/design/mockups/smart-kitchen-prototype.html</code> (v6) and <code>docs/design/tokens.md</code>. Strings are copied from the prototype and <code>copy-deck.md</code>. ${dark ? 'Dark values are derived by <code>build-previews.mjs</code>; see README.md.' : 'Regenerate with <code>node build-previews.mjs</code>.'}</p>
</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart Kitchen Tokens ${dark ? 'Dark' : 'Light'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400..700&family=Schibsted+Grotesk:wght@400..800&display=swap" rel="stylesheet">
<style>${root}${CSS}</style>
</head>
<body>${ICONS}${body}
</body>
</html>
`;
}

writeFileSync(new URL('./preview.html', import.meta.url), page('light'));
writeFileSync(new URL('./preview-dark.html', import.meta.url), page('dark'));
writeFileSync(new URL('./dark-contrast.json', import.meta.url), JSON.stringify({ dark: D, literals: Object.fromEntries(Object.entries(LIT).map(([k, v]) => [k, v[1]])), pairs: results }, null, 2) + '\n');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FLAG'} ${r.r.toFixed(2)} (>=${r.tgt}) ${r.label}  ${r.fg} on ${r.bg}`);
