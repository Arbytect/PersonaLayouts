// dossier_generator.js
// Parametric Spatial Dossier Engine Orchestrator
// Decouples Static HTML Framework from dynamic persona, rules, and vector overlays.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { loadEnvFile, getChromeExecutablePath } = require('./env-loader');

// Define Paths
const DATA_DIR = path.join(__dirname, 'data');
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'dossier_template.html');
const OUTPUT_DIR = path.join(__dirname, 'output');
const EMPTY_PNG_DIR = path.join(__dirname, 'rooms-empty', 'png');
const GENERATED_DIR = path.join(OUTPUT_DIR, 'generated');

function safeFilePart(value) {
    return String(value || 'base').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'base';
}

function imageFileToDataUri(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    const buffer = fs.readFileSync(filePath);
    return 'data:' + mime + ';base64,' + buffer.toString('base64');
}

// Ensure Output Directory exists
loadEnvFile(path.join(__dirname, '.env'));

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

function assertNoUnresolvedPlaceholders(html) {
    const unresolved = [...html.matchAll(/{{[A-Z0-9_]+}}/g)].map(match => match[0]);
    const unique = [...new Set(unresolved)];
    if (unique.length > 0) {
        throw new Error(`Unresolved template placeholder(s): ${unique.join(', ')}`);
    }
}

// 1. HELPERS FOR ARGUMENT PARSING
function parseArgs() {
    const args = {};
    process.argv.slice(2).forEach(val => {
        if (val.startsWith('--')) {
            const parts = val.substring(2).split('=');
            args[parts[0]] = parts[1] === 'true' ? true : parts[1] === 'false' ? false : parts[1];
        }
    });
    // Set robust defaults matching the Sovereign Living Room dossier
    return {
        package: String(args.package || '39').replace('$', ''),
        persona: args.persona || 'sovereign',
        variant: args.variant || null,
        room_type: args.room_type || 'living_room',
        room_size: args.room_size || 'compact',
        occupancy: args.occupancy || 'solo',
        pain: args.pain || 'storage',
        pets: args.pets !== undefined ? args.pets : false,
        use_api: args.use_api === true || args.use_api === 'true' || process.env.PDF_USE_API === 'true',
        customer_name: args.customer_name || process.env.PDF_CUSTOMER_NAME || 'Your Layout',
        order_id: args.order_id || null,
        ai_enrichment_file: args.ai_enrichment_file || null,
        original_photo_file: args.original_photo_file || null,
        cover_image_file: args.cover_image_file || null,
        output_file: args.output_file || null
    };
}

// 2. DATABASES FOR DESIGN MANIFESTO
const DESIGN_LANGUAGES = {
    sovereign: {
        style: 'Refined Contemporary',
        feel: 'Controlled warmth. Surfaces speak, objects remain silent.',
        approach: 'Refining existing room character while enforcing surface discipline.',
        lifeFlow: 'Ready for occasional guests, but primarily optimized around the occupant\'s direct focus vectors.',
        literacy: 'Enforces precise tolerances, joint quality, and zero tolerance for cheap details.',
        diff: 'Modern Luxury is about flashy, glossy surfaces and immediate showroom impact. Refined Contemporary represents quiet authority, raw material discipline, and architectural simplicity.'
    },
    sage: {
        style: 'Silent Sanctuary',
        feel: 'Acoustic envelope, cozy cocoon, and low-contrast comfort.',
        approach: 'Minimizing cognitive load and creating an introspective restoration cell.',
        lifeFlow: 'Acts as an isolation sanctuary from outer domestic noise, supporting deep resting or reading.',
        literacy: 'Focuses on sound isolation, complete light-blocking details, and matte, light-absorbing finishes.',
        diff: 'Cozy Styling scatters decorative pillows and candles. Silent Sanctuary uses acoustic felt wall panels, blackout layers, and custom sightline shields to secure deep, uninterrupted recovery.'
    },
    alchemist: {
        style: 'Adaptive Minimalist',
        feel: 'Dynamic energy, raw flexibility, and multi-modal usability.',
        approach: 'Enforcing modular agility and swift zoning transformations.',
        lifeFlow: 'Enables rapid mode-switching (e.g., focus work to yoga practice to hosting) within compressed bounds.',
        literacy: 'Requires high-quality rolling tracks, folding hinges, and mobile modular joints.',
        diff: 'Traditional Rooms lock furniture along perimeters. Adaptive Minimalist leaves a 1.5m central grid completely free, utilizing lightweight elements on casters for fluid transitions.'
    },
    weaver: {
        style: 'Organic Modernism',
        feel: 'Social warmth, soft edges, and inviting natural textures.',
        approach: 'Centering conversational loops and enriching tactile material warmth.',
        lifeFlow: 'Optimized to anchor human interaction, shared meals, and proximity-driven social rituals.',
        literacy: 'Focuses on touch quality, hand-made tile joints, and seamless timber-to-stone transitions.',
        diff: 'Minimal Styling strips organic textures to achieve cleanliness. Organic Modernism introduces boucle, linen, and terracotta in a structured layout that keeps main circulation lanes free.'
    }
};

const DESIGN_PRINCIPLES = {
    sovereign: [
        { title: 'Surfaces Speak', text: 'Value comes from travertine, plaster, wood grain, and light interaction.' },
        { title: 'Preserve Character', text: 'Enforce and restore high-value existing elements (hearth, parquet) rather than replacing them.' },
        { title: 'Furniture is Silent', text: 'All furniture serves a strict layout function and remains low and unobtrusive.' },
        { title: 'Lighting Sets the Stage', text: 'Layered 2700K ambient glow with dimmer controls, avoiding overhead floods.' },
        { title: 'Texture Over Color', text: 'The palette is kept narrow; rich tactile depth comes from walnut, stone, and woven textiles.' },
        { title: 'Void is Part of the Design', text: 'Deliberate empty spaces are protected to allow the room to breathe.' }
    ],
    sage: [
        { title: 'Acoustic Absorption', text: 'Prioritize thick wool, felt panels, and velvet curtains to absorb high-frequency noise.' },
        { title: 'Shielded Sightlines', text: 'Block direct views of active doorways and dressing storage from the focus point.' },
        { title: 'Monastic Seating', text: 'Float a single reading chair in a low-stimulation corner, separated from walking zones.' },
        { title: 'Coned Illumination', text: 'Dedicated focus task lamps leave the room perimeter in deep, relaxing shadow.' },
        { title: 'Matte Over Gloss', text: 'Use low-contrast, light-absorbing surfaces to protect eyes from daylight glare.' },
        { title: 'Zero Decoration Clutter', text: 'Surfaces are kept completely clear to allow the brain to exit active processing.' }
    ],
    alchemist: [
        { title: 'Modular Boundaries', text: 'Use sliding felt panels and rolling dividers to partition zones instantly.' },
        { title: 'Unanchored Center', text: 'Keep the middle floor area free of heavy stationary coffee tables.' },
        { title: 'Adaptive Furniture', text: 'Integrate drop-leaf folding tables and multi-tier utility carts.' },
        { title: 'Dynamic Illumination', text: 'Smart lighting grids capable of switching from warm ambient to focus daylight.' },
        { title: 'Tactile Industrial Textures', text: 'Plywood, aluminum, powder-coated steel, and synthetic felt.' },
        { title: 'Fluid Storage Rails', text: 'Wall-mounted pegboards keep cables and equipment elevated and mobile.' }
    ],
    weaver: [
        { title: 'Centripetal Seating', text: 'Arrange seating in curved U-shapes around a low, shared coffee table.' },
        { title: 'Tactile Warmth', text: 'Layer heavy woven linen, boucle, jute, and raw rustic timber.' },
        { title: 'Shared Focal Anchors', text: 'Use large kitchen islands or low credenzas to ground conversation.' },
        { title: 'Layered Ambient Glow', text: 'Pendant lights hung low over tables combined with candles and uplights.' },
        { title: 'Earthy Color Palettes', text: 'Warm greige, soft terracotta, raw clay, and cream tones.' },
        { title: 'Conversational Circulation', text: 'Keep a generous 90cm pathway clear behind main social seating groups.' }
    ]
};

const ZONES_DATA = {
    living_room: [
        { name: "Conversational Loop & Lounge Area", pct: 0.60, personas: "Sovereign 60% | Sage 25% | Weaver 15%", rationale: "The primary social anchor. Houses clean 3+1 sofa layouts floated off the wall to establish a conversational gravity center." },
        { name: "TV Wall & Architectural Backbone", pct: 0.25, personas: "Sovereign 85% | Sage 15%", rationale: "Features a clean vein-cut travertine slab floor-to-ceiling overlay with floating low media console to anchor vertical sightlines." },
        { name: "Fireplace Focus Zone", pct: 0.15, personas: "Sage 70% | Weaver 30%", rationale: "A quiet alcove with modernized limewash brick, deep velvet armchair, and dedicated reading floor lamp." }
    ],
    bedroom: [
        { name: "Sleep Cocoon", pct: 0.60, personas: "Sage 60% | Sovereign 40%", rationale: "Bed positioned against flat headboard wall with integrated headboard textile upholstery and ambient halo illumination." },
        { name: "Integrated Dressing System", pct: 0.30, personas: "Sovereign 80% | Sage 20%", rationale: "Dressing alcove oriented along the diagonal wall, concealed behind sliding neutral panels." },
        { name: "Transition Entry", pct: 0.10, personas: "Sovereign 90% | Sage 10%", rationale: "Acoustic vestibule zoning to block hallway draft and sound leaks." }
    ],
    kitchen: [
        { name: "Culinary Prep Triangle", pct: 0.50, personas: "Sovereign 75% | Weaver 20% | Sage 5%", rationale: "Prep countertops, sink, and oven grouped in a clean task-driven line with push-to-open flat matte grey doors." },
        { name: "Breakfast & Chill Zone", pct: 0.35, personas: "Weaver 70% | Sage 30%", rationale: "Features a warm central wood dining table and light woven chairs to invite gathering." },
        { name: "Concealed Utility Storage", pct: 0.15, personas: "Sovereign 90% | Sage 10%", rationale: "Integrated refrigerator and pantry units matching the wall surfaces to reduce visual weight." }
    ],
    home_office: [
        { name: "Executive Command Desk", pct: 0.55, personas: "Sovereign 80% | Sage 20%", rationale: "Symmetrical desk orientation facing the room's main entrance pathway to command spatial authority." },
        { name: "Quiet Reading Alcove", pct: 0.35, personas: "Sage 70% | Weaver 30%", rationale: "Single lounge chair, reading light, and floor-to-ceiling bookshelf floated off transit zones." },
        { name: "Void / Breath Zone", pct: 0.10, personas: "Sage 50% | Sovereign 40% | Weaver 10%", rationale: "Deliberate empty floor space near window to support cognitive resting intervals." }
    ],
    studio: [
        { name: "Sleep Sanctuary", pct: 0.40, personas: "Sage 60% | Sovereign 40%", rationale: "Bed area tucked away behind structural vertical panel or high bookcase to block visual noise." },
        { name: "Active Lounge & Dining", pct: 0.30, personas: "Weaver 60% | Sovereign 40%", rationale: "Multi-functional dining/sofa setup acting as the main social hub." },
        { name: "Task Focus Desk", pct: 0.20, personas: "Sovereign 80% | Sage 20%", rationale: "Dedicated work desk rotated away from the sleep axis to prevent stress bleed." },
        { name: "Entry Corridor", pct: 0.10, personas: "Sovereign 90%", rationale: "Closet and shoe organization unit to catch clutter immediately upon entering." }
    ],
    balcony: [
        { name: "Outdoor Rest Lounge", pct: 0.60, personas: "Sage 70% | Weaver 30%", rationale: "Lounge chairs and small stone table configured as a quiet sanctuary facing green views." },
        { name: "Perimeter Botanical Buffer", pct: 0.40, personas: "Sovereign 80% | Sage 20%", rationale: "Thick wind-diffusing planters flanking the outer rail to secure privacy from street sightlines." }
    ],
    open_plan: [
        { name: "Primary Lounge & Media Center", pct: 0.45, personas: "Sovereign 60% | Weaver 40%", rationale: "Main seating anchor defined by rug boundary, separating television noise from prep areas." },
        { name: "Culinary Island & Dining Anchor", pct: 0.35, personas: "Sovereign 70% | Weaver 30%", rationale: "Dekton island with bar stool seating to gather guests during prep." },
        { name: "Acoustic Focus/Office Nook", pct: 0.20, personas: "Sage 80% | Sovereign 20%", rationale: "Quiet workspace alcove shielded by soft felt partitions or acoustic panels." }
    ]
};

// 3. DYNAMIC SVG OVERLAY GENERATORS
function generateSVGOverlay(persona, roomSize, isAfter = false) {
    let width = 400;
    let height = 300;
    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="position: absolute; inset: 0; width:100%; height:100%; pointer-events: none;">`;
    
    svg += `
        <defs>
            <radialGradient id="glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#9c4f2b" stop-opacity="0.15" />
                <stop offset="100%" stop-color="#9c4f2b" stop-opacity="0" />
            </radialGradient>
            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
            </marker>
            <marker id="dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4">
                <circle cx="5" cy="5" r="3" fill="var(--accent-soft)" />
            </marker>
        </defs>
    `;

    if (!isAfter) {
        // Red stress overlay representation
        svg += `
            <line x1="200" y1="20" x2="200" y2="280" stroke="rgba(239, 83, 80, 0.35)" stroke-width="1" stroke-dasharray="4 4" />
            <line x1="40" y1="150" x2="360" y2="150" stroke="rgba(239, 83, 80, 0.35)" stroke-width="1" stroke-dasharray="4 4" />
            <rect x="160" y="120" width="80" height="60" fill="rgba(239, 83, 80, 0.08)" stroke="#ef5350" stroke-width="1.5" />
            <rect x="150" y="137" width="100" height="25" rx="3" fill="#0d0b0a" stroke="#ef5350" stroke-width="0.75" />
            <text x="200" y="152" fill="#ef5350" style="font-family:'DM Mono', monospace; font-size:7px; font-weight:700;" text-anchor="middle">STATIK_CONFLICT_ZONE</text>
        `;
    } else {
        // Symmetrical gold correction layout vectors
        if (persona === 'sovereign') {
            svg += `
                <line x1="380" y1="260" x2="120" y2="80" stroke="var(--accent)" stroke-width="2" stroke-dasharray="8,6" marker-end="url(#arrow)" />
                <circle cx="380" cy="260" r="5" fill="var(--accent)" />
                <text x="390" y="275" fill="var(--accent-soft)" font-family="DM Mono" font-size="7px" letter-spacing="0.5">COMMAND AXIS</text>
                <path d="M 320 280 L 200 280" stroke="var(--accent-soft)" stroke-width="1" marker-start="url(#dot)" marker-end="url(#dot)" />
                <text x="260" y="292" fill="var(--mid)" font-family="DM Mono" font-size="6.5px" text-anchor="middle">SOFA FLOAT: 60cm MIN</text>
            `;
        } else if (persona === 'weaver') {
            svg += `
                <circle cx="200" cy="150" r="75" fill="url(#glow)" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5,5" />
                <circle cx="200" cy="150" r="3" fill="var(--accent)" />
                <text x="200" y="130" fill="var(--accent-soft)" font-family="DM Mono" font-size="7px" text-anchor="middle" letter-spacing="1">CONVERSATIONAL CENTER</text>
            `;
        } else if (persona === 'sage') {
            svg += `
                <path d="M 120 260 L 80 120 L 220 120 Z" fill="url(#glow)" stroke="var(--accent-soft)" stroke-width="1.2" stroke-dasharray="4,4" />
                <circle cx="120" cy="260" r="4" fill="var(--accent)" />
                <text x="120" y="280" fill="var(--accent)" font-family="DM Mono" font-size="7px" text-anchor="middle">FOCUS NODE</text>
            `;
        } else {
            svg += `
                <path d="M 80 80 C 180 80, 220 220, 360 220" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="6,6" marker-end="url(#arrow)" />
                <text x="95" y="70" fill="var(--mid)" font-family="DM Mono" font-size="7px">KINETIC FLOW TRANSITION</text>
            `;
        }
    }

    svg += `</svg>`;
    return svg;
}

// 4. DETAILED SPECIFICATIONS RESOLVER
function resolveSpecifications(persona) {
    if (persona === 'sovereign') {
        return {
            lighting: "Clinical, low-level warm spotlight system. Strict directional light pools focused directly over active seating points. Zero overhead washing, maintaining spatial shadows.",
            textures: "Matte high-durability surfaces. Ultra-precise brushed steel details, micro-framed concrete surfaces, and tight-woven flat charcoal wool rugs.",
            materials: "Dark tinted oak, polished graphite marbles, absolute clear structural glass panels, and raw surgical steel supports.",
            spacing: "Minimum 80cm clear primary circulation boundaries, with a sofa float clearance of exactly 60cm off all wall boundaries. No diagonal layouts."
        };
    } else if (persona === 'weaver') {
        return {
            lighting: "Layered amber envelope. Soft pendant lighting glowing at eye level when seated, combined with accent table candles and warm corner uplights.",
            textures: "Deep-pile soft boucle fabrics, layered thick organic wool throws, textured raw rustic linen curtains, and soft woven jute base rugs.",
            materials: "Warm light oak woods, rich terracotta stoneware, brushed copper fixtures, and soft matte clay wall surfaces.",
            spacing: "Conversational circular clearance layout maintaining a minimum 90cm radius between primary seats, allowing active domestic flow."
        };
    } else if (persona === 'sage') {
        return {
            lighting: "Monastic localized focal lamps. Single warm directional desk and armchair reading lights. Rest of the space remains in deep atmospheric shadow.",
            textures: "Heavy light-absorbing blackout velvet drapery, dense flat wool underfoot, and soft natural leather writing surfaces.",
            materials: "Deep forest teak woods, matte absolute black slate tiles, raw cold rolled steel, and thick structured concrete blocks.",
            spacing: "Desk oriented facing calm window aperture, with reading armchair floated away from all pathways to ensure zero traffic disturbance."
        };
    } else {
        return {
            lighting: "Dynamic dimmable smart lighting grid. Ability to switch color temperatures instantly from 2700K cozy amber to 4000K daylight work mode.",
            textures: "Adaptable light canvas fabrics, modular felt wall dividers, and easy-clean woven synthetic composite rugs on glides.",
            materials: "Sustainable bamboo boards, lightweight powder-coated aluminum, modular folding glass partitions, and vibrant structural plastics.",
            spacing: "Central 1.5m x 1.5m clearance grid left completely free. Furniture elements equipped with easy-glide rollers for modular mode shifts."
        };
    }
}

function hexToRgbParts(hex) {
    const clean = String(hex || '').replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '156, 79, 67';
    const value = parseInt(clean, 16);
    return [
        (value >> 16) & 255,
        (value >> 8) & 255,
        value & 255
    ].join(', ');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDateForDossier(date = new Date()) {
    return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

function labelFromKey(value) {
    return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function resolveSpatialTension(persona, pain) {
    if (pain === 'storage') return 'Command point missing';
    if (pain === 'circulation') return 'Transit path conflict';
    if (pain === 'privacy') return 'Boundary missing';
    if (pain === 'focus') return 'Focus anchor missing';
    if (persona === 'sage') return 'Sensory boundary missing';
    if (persona === 'alchemist') return 'Mode switching friction';
    if (persona === 'weaver') return 'Social anchor diffuse';
    return 'Primary anchor missing';
}

function resolveDossierId(config) {
    if (config.order_id) return '#' + safeFilePart(config.order_id).toUpperCase();
    return '#' + String(config.room_size || 'compact').toUpperCase() + '-01';
}

function resolvePainSpec(painKey) {
    const specs = {
        storage: {
            field: "storage",
            text: "Pain-specific storage correction applied: Enforce 80%+ closed cabinetry. Deactivate open display units below eye level and implement flush-mount push-to-open doors to clear visual noise."
        },
        circulation: {
            field: "geometry",
            text: "Pain-specific circulation correction applied: Restructure flow corridors to meet Neufert standards. Ensure main transit lanes maintain a minimum 90cm clear path."
        },
        atmosphere: {
            field: "lighting",
            text: "Pain-specific atmospheric correction applied: Deactivate high-contrast ceiling lights. Deploy dimmable 2700K warm ambient sources to create localized pools of illumination."
        },
        zoning: {
            field: "geometry",
            text: "Pain-specific zoning correction applied: Delineate functional boundaries using large area rugs and low-profile credenzas to prevent zone bleed."
        },
        workspace: {
            field: "geometry",
            text: "Pain-specific workspace correction applied: Expand active desk depth to 75cm+ and reclaim flat surfaces using wall-mounted monitor arms."
        },
        workflow: {
            field: "geometry",
            text: "Pain-specific workflow correction applied: Clear a continuous 90cm prep plane and position active utensils within arm's reach of cooking centers."
        },
        kitchen_triangle: {
            field: "geometry",
            text: "Pain-specific triangle correction applied: Adjust sink-to-fridge-to-cooktop distance to fall within Neufert guidelines (under 6m total path)."
        },
        sleep_quality: {
            field: "geometry",
            text: "Pain-specific sleep correction applied: Rotate bed to clear transit sightlines and secure a solid headboard backing wall to establish stability."
        },
        privacy: {
            field: "geometry",
            text: "Pain-specific privacy correction applied: Install vestibule partitions or heavy vertical divider curtains to block direct sightlines from active entries."
        },
        focus: {
            field: "geometry",
            text: "Pain-specific focus correction applied: Position desk in the 'Command Position' facing the doorway, backed by a solid wall, and install acoustic felt wall panels."
        },
        functionality: {
            field: "geometry",
            text: "Pain-specific functionality correction applied: Reclaim underutilized space by deploying lightweight folding drop-leaf tables and modular components."
        },
        transition: {
            field: "storage",
            text: "Pain-specific transition correction applied: Install a low entryway credenza to serve as a designated threshold drop zone, keeping footwear and clutter enclosed."
        },
        hierarchy: {
            field: "geometry",
            text: "Pain-specific hierarchy correction applied: Align seating loop symmetrically along a primary focal axis to establish a single dominant visual anchor."
        },
        behavioral_separation: {
            field: "geometry",
            text: "Pain-specific boundary correction applied: Install sliding felt partition panels and separate lighting circuits to split focus work from rest zones."
        }
    };
    return specs[painKey] || null;
}

// 5. CORE COMPILER FUNCTION

function resolvePainNarrative(painKey) {
    const narratives = {
        storage: { label: 'Storage overload', target: 'closed storage and surface discipline', action: 'move loose utilities into vertical or enclosed addresses' },
        circulation: { label: 'Circulation friction', target: 'clear walking lanes', action: 'protect the main transit path before styling anything' },
        atmosphere: { label: 'Atmosphere mismatch', target: 'warmer layered light', action: 'replace general overhead brightness with lower local light pools' },
        zoning: { label: 'Zone bleed', target: 'clear functional boundaries', action: 'anchor each activity with a rug, light source, or low storage edge' },
        workspace: { label: 'Workspace drag', target: 'a deeper focused work plane', action: 'separate work tools from rest surfaces' },
        workflow: { label: 'Workflow interruption', target: 'continuous prep sequence', action: 'group the tools used together inside one reach zone' },
        kitchen_triangle: { label: 'Kitchen triangle break', target: 'shorter sink-fridge-cooktop movement', action: 'remove obstacles from the core cooking path' },
        sleep_quality: { label: 'Sleep instability', target: 'a protected bed axis', action: 'reduce direct sightlines and light leaks around the sleep zone' },
        privacy: { label: 'Privacy leak', target: 'stronger visual thresholds', action: 'block direct view lines with textile or panel boundaries' },
        focus: { label: 'Focus leakage', target: 'a controlled command/focus position', action: 'turn the primary seat away from busy movement vectors' },
        functionality: { label: 'Function compression', target: 'multi-mode furniture logic', action: 'clear one adaptable center zone before adding objects' },
        transition: { label: 'Entry transition clutter', target: 'a controlled landing strip', action: 'assign shoes, bags, and keys a single threshold address' },
        hierarchy: { label: 'Weak visual hierarchy', target: 'one dominant focal axis', action: 'choose the main anchor and demote competing objects' },
        behavioral_separation: { label: 'Behavioral overlap', target: 'separate work and recovery signals', action: 'split lighting and storage cues by activity mode' }
    };
    return narratives[painKey] || { label: 'Spatial friction', target: 'clearer room logic', action: 'remove competing signals from the primary activity zone' };
}

function resolveOccupancyNarrative(config, activeModifiers) {
    let base;
    if (config.occupancy === 'family') base = { label: 'Family rhythm', text: 'The plan prioritizes wider shared circulation, durable contact surfaces, and fewer collision points between simultaneous routines.' };
    else if (config.occupancy === 'couple' || config.occupancy === 'partner') base = { label: 'Dual rhythm', text: 'The plan protects two parallel routines by separating storage addresses and keeping the main path readable from both sides.' };
    else if (config.pets) base = { label: 'Solo plus pet', text: 'The plan avoids fragile floor clutter, filters risky plants, and keeps low storage closed so the room remains calm and pet-safe.' };
    else base = { label: activeModifiers.label || 'Solo rhythm', text: 'The plan can be sharper and more personal: one primary seat, one dominant axis, and fewer compromise zones.' };

    // Persona-specific occupancy framing (occupancy_modifiers.json persona_notes, added 2026-07-14):
    // grounds the generic occupancy narrative in how THIS persona specifically experiences that
    // living arrangement, instead of a one-size-fits-all sentence for all four archetypes.
    const personaNote = activeModifiers.persona_notes?.[config.persona];
    if (personaNote) {
        base.text += ' ' + personaNote;
    }
    return base;
}

function buildSevenDayPlan(config, painInfo, priorityActionsList) {
    if (config.pain === 'storage') {
        return [
            'Photograph the room from the entry. Mark the first object that visually interrupts the main surface line.',
            priorityActionsList[0] || 'Clear open storage below eye level into uniform closed containers.',
            priorityActionsList[1] || 'Consolidate remotes, cables, chargers, and loose daily items into one closed address.',
            'Define one reward corner: a single chair, one lamp, one function. No second-purpose clutter.',
            priorityActionsList[2] || 'Hide every visible cable behind the media line or under-furniture channel.',
            'Night test: confirm the main activity works without switching on every ceiling light.',
            'Hold the winning layout for 48 hours, then buy only the items that solved a friction you felt twice.'
        ];
    }
    return [
        'Photograph the room from the entry and mark the first object that visually interrupts ' + painInfo.target + '.',
        priorityActionsList[0] || 'Clear the primary surface and assign every loose item one storage address.',
        priorityActionsList[1] || 'Open a measured circulation lane and keep it free for one full day.',
        'Create one ' + painInfo.label.toLowerCase() + ' correction zone using light, rug, panel, or closed storage.',
        priorityActionsList[2] || 'Move the most-used object into arm\'s reach and remove the least-used object from the room.',
        'Test the room at night: confirm the main activity works without switching on every ceiling light.',
        'Keep the winning layout for 48 hours, then buy only the items that solve the repeated friction point.'
    ];
}

function buildPrescriptionContent({ config, pDetails, diagnosis, activeModifiers, priorityActionsList, area_m2, aiEnrichment }) {
    const painInfo = resolvePainNarrative(config.pain);
    const occupancyInfo = resolveOccupancyNarrative(config, activeModifiers);
    const roomLabel = config.room_type.replace(/_/g, ' ');
    const headline = aiEnrichment?.headline || (painInfo.label + ' in a ' + roomLabel);
    const visualPrompt = aiEnrichment?.visual_prompt || (pDetails.style + ' ' + roomLabel + ', correcting ' + painInfo.label.toLowerCase() + ' through ' + painInfo.target + ', ' + config.room_size + ' footprint, ' + occupancyInfo.label.toLowerCase() + ', editorial architectural interior, no people, no text.');
    const cards = aiEnrichment?.cards || [
        { label: 'Primary diagnosis', title: painInfo.label, text: (diagnosis.brutal_observation || 'The room is sending too many competing signals.') + ' <strong>The paid value is not decoration; it is deciding what must stop competing first.</strong>' },
        { label: 'Correction target', title: painInfo.target, text: 'Your first correction is to ' + painInfo.action + '. This makes the room feel designed before any expensive purchase happens.' },
        { label: 'Lifestyle modifier', title: occupancyInfo.label, text: occupancyInfo.text },
        { label: 'Design language', title: pDetails.style, text: pDetails.feel + ' The ' + area_m2 + ' m2 footprint needs fewer visible decisions and stronger spatial hierarchy.' }
    ];
    const cardHtml = cards.slice(0, 4).map((card, idx) => '\n      <div class="prescription-card ' + (idx === 0 ? 'accent' : '') + '">\n        <div class="rx-label">' + escapeHtml(card.label) + '</div>\n        <div class="rx-title">' + escapeHtml(card.title) + '</div>\n        <div class="rx-text">' + escapeHtml(card.text) + '</div>\n      </div>\n    ').join('');
    const plan = (aiEnrichment?.seven_day_plan || buildSevenDayPlan(config, painInfo, priorityActionsList)).slice(0, 7);
    const planHtml = plan.map((task, idx) => '\n      <div class="day-card">\n        <div class="day-num">Day ' + (idx + 1) + '</div>\n        <div class="day-task">' + escapeHtml(task) + '</div>\n      </div>\n    ').join('');
    const visualBriefHtml = '';
    return { headline, cardHtml, planHtml, visualBriefHtml, visualPrompt };
}

function parseJsonFromModelText(text) {
    const raw = String(text || '').trim();
    if (raw.startsWith('```')) {
        const withoutStart = raw.replace(/^```[a-zA-Z]*\s*/, '');
        const withoutEnd = withoutStart.replace(/\s*```$/, '');
        return JSON.parse(withoutEnd.trim());
    }
    return JSON.parse(raw);
}

async function fetchAiEnrichment(config, context) {
    if (config.ai_enrichment_file) {
        const enrichmentPath = path.resolve(config.ai_enrichment_file);
        if (!fs.existsSync(enrichmentPath)) throw new Error('AI enrichment file not found: ' + enrichmentPath);
        const enrichment = JSON.parse(fs.readFileSync(enrichmentPath, 'utf8'));
        if (!Array.isArray(enrichment.cards) || !Array.isArray(enrichment.seven_day_plan)) {
            throw new Error('AI enrichment file must include cards and seven_day_plan arrays.');
        }
        return enrichment;
    }
    if (!config.use_api) return null;
    if (!process.env.OPENAI_API_KEY) {
        console.warn('[AI enrichment] OPENAI_API_KEY missing; using deterministic local content.');
        return null;
    }
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const prompt = 'Create concise premium PDF personalization JSON for a $39 interior spatial diagnosis. Return only JSON with keys: headline, cards (4 objects: label,title,text), seven_day_plan (7 strings), visual_prompt. Context: ' + JSON.stringify(context);
    try {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
            body: JSON.stringify({ model, input: prompt, temperature: 0.4 })
        });
        if (!response.ok) {
            console.warn('[AI enrichment] API returned ' + response.status + '; using local content.');
            return null;
        }
        const payload = await response.json();
        const outputText = payload.output_text || (payload.output || []).flatMap(item => item.content || []).map(part => part.text || '').join('') || '';
        return parseJsonFromModelText(outputText);
    } catch (error) {
        console.warn('[AI enrichment] ' + error.message + '; using local content.');
        return null;
    }
}


async function generateOpenAiConceptImage(config, visualPrompt) {
    if (config.cover_image_file) {
        const coverPath = path.resolve(config.cover_image_file);
        if (!fs.existsSync(coverPath)) throw new Error('Cover image file not found: ' + coverPath);
        return { path: coverPath, dataUri: imageFileToDataUri(coverPath), cached: true, supplied: true };
    }
    if (!config.use_api) return null;
    if (!process.env.OPENAI_API_KEY) {
        console.warn('[Image generation] OPENAI_API_KEY missing; using isometric fallback.');
        return null;
    }

    const imageKey = [config.persona, config.variant || 'base', config.room_type, config.room_size, config.occupancy, config.pain].map(safeFilePart).join('_');
    const imagePath = path.join(GENERATED_DIR, imageKey + '.png');
    if (fs.existsSync(imagePath) && process.env.PDF_REGENERATE_IMAGES !== 'true') {
        return { path: imagePath, dataUri: imageFileToDataUri(imagePath), cached: true };
    }

    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1-mini';
    const quality = process.env.OPENAI_IMAGE_QUALITY || 'low';
    const size = process.env.OPENAI_IMAGE_SIZE || '1536x1024';
    const outputFormat = process.env.OPENAI_IMAGE_FORMAT || 'png';
    const prompt = visualPrompt + '\n\nMake it usable as a premium PDF cover image: architectural interior concept, elegant editorial lighting, realistic materials, no text, no people, no logos, no watermark.';

    try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + process.env.OPENAI_API_KEY
            },
            body: JSON.stringify({
                model,
                prompt,
                size,
                quality,
                output_format: outputFormat
            })
        });

        if (!response.ok) {
            const message = await response.text();
            console.warn('[Image generation] OpenAI returned ' + response.status + ': ' + message.slice(0, 180) + '. Using isometric fallback.');
            return null;
        }

        const payload = await response.json();
        const b64 = payload.data && payload.data[0] && payload.data[0].b64_json;
        if (!b64) {
            console.warn('[Image generation] No b64_json returned; using isometric fallback.');
            return null;
        }

        fs.writeFileSync(imagePath, Buffer.from(b64, 'base64'));
        return { path: imagePath, dataUri: imageFileToDataUri(imagePath), cached: false };
    } catch (error) {
        console.warn('[Image generation] ' + error.message + '; using isometric fallback.');
        return null;
    }
}

function buildCoverVisualHtml(generatedVisual, base64IsometricImg) {
    if (generatedVisual && generatedVisual.dataUri) {
        return '<img src="' + generatedVisual.dataUri + '" alt="AI generated room concept" style="width:100%; height:100%; object-fit:cover; filter: contrast(1.05) saturate(0.92);">';
    }
    return '<img src="' + base64IsometricImg + '" alt="Empty Room Isometric View" style="max-width:100%; max-height:100%; object-fit:contain; filter: invert(0.92) hue-rotate(180deg) contrast(1.15) brightness(0.95);">';
}

function buildPhotoAuditPages(config, aiEnrichment, generatedVisual) {
    if (config.package !== '59') return '';
    if (!config.original_photo_file || !fs.existsSync(path.resolve(config.original_photo_file))) {
        throw new Error('$59 dossier requires the customer original_photo_file.');
    }
    if (!generatedVisual || !generatedVisual.dataUri) {
        throw new Error('$59 dossier requires a generated room transformation image.');
    }
    const observations = aiEnrichment && aiEnrichment.observations;
    if (!Array.isArray(observations) || observations.length !== 5) {
        throw new Error('$59 dossier requires exactly five photo-specific observations.');
    }

    const originalDataUri = imageFileToDataUri(path.resolve(config.original_photo_file));
    const observationHtml = observations.map((item, index) => `
      <div class="photo-observation">
        <div class="photo-observation-num">0${index + 1}</div>
        <div>
          <div class="photo-observation-title">${escapeHtml(item.title)}</div>
          <div class="photo-observation-grid">
            <div><span>Visible problem</span>${escapeHtml(item.problem)}</div>
            <div><span>Why it matters</span>${escapeHtml(item.behavioral_impact)}</div>
            <div><span>Correction</span>${escapeHtml(item.action_plan)}</div>
          </div>
        </div>
      </div>`).join('');

    return `
<div class="page type-a">
  <div class="pg-hdr"><div class="pg-hdr-brand">PersonaLayouts</div><div class="pg-hdr-right">Room Transform | Before / After</div></div>
  <div class="body">
    <div class="eyebrow">RT-01 - Photographic Evidence</div>
    <div class="section-title">Your Actual Room<br><em>Observed state and proposed correction</em></div>
    <div class="before-after-grid">
      <div class="photo-frame before"><div class="photo-frame-label">Before - Customer Photograph</div><img src="${originalDataUri}" alt="Customer room before transformation"></div>
      <div class="photo-frame after"><div class="photo-frame-label">After - Proposed Direction</div><img src="${generatedVisual.dataUri}" alt="AI-assisted proposed room transformation"></div>
    </div>
    <div class="transform-evidence-note"><strong>What this visual means</strong><br>This is a photo-led design direction, not a construction drawing. It preserves the photographed viewpoint and tests the recommended layout, lighting and storage corrections before purchase. Confirm dimensions and fixed services on site.</div>
    <div class="transform-proof-grid">
      <div><span>Source</span>Customer-uploaded room photograph</div>
      <div><span>Method</span>Vision audit + controlled image edit</div>
      <div><span>Scope</span>Layout, lighting, storage and visual hierarchy</div>
    </div>
  </div>
  <div class="pg-ftr"><div class="pg-ftr-l">PersonaLayouts Room Transform</div><div class="pg-ftr-r">RT-01 - Before / After</div></div>
</div>
<div class="page type-b">
  <div class="pg-hdr"><div class="pg-hdr-brand">PersonaLayouts</div><div class="pg-hdr-right">Room Transform | Photo Audit</div></div>
  <div class="body">
    <div class="eyebrow">RT-02 - Five Visible Frictions</div>
    <div class="section-title">What the Photograph Reveals<br><em>Five specific problems and their corrections</em></div>
    <div class="photo-observation-list">${observationHtml}</div>
    <div class="photo-audit-limit">Findings are limited to visible evidence in the submitted photograph. Hidden dimensions, services and structural conditions require on-site verification.</div>
  </div>
  <div class="pg-ftr"><div class="pg-ftr-l">PersonaLayouts Room Transform</div><div class="pg-ftr-r">RT-02 - Photo Audit</div></div>
</div>`;
}

// Finds a real, purchasable product match from the plants_products.json furniture catalog for a
// given piece role. Physical fit is never relaxed before style: preferring an exact persona-family +
// size-bucket match, then a size-safe match of any persona (a wrong-size item is a real-world failure,
// a wrong-style item is just a mismatch of taste), then a persona match regardless of size only if no
// size-safe option exists at all, so every piece has the best available real link rather than none.
function findRealProduct(catalog, roomType, role, personaBase, sizeKey) {
    const pool = (catalog.furniture || []).filter(item => item.role === role && (item.room_alignment || []).includes(roomType));
    if (pool.length === 0) return null;
    const fitsSize = item => !item.size_alignment || item.size_alignment.includes(sizeKey);
    const exact = pool.find(item => (item.persona_alignment || []).includes(personaBase) && fitsSize(item));
    if (exact) return exact;
    const sizeMatch = pool.find(fitsSize);
    if (sizeMatch) return sizeMatch;
    const personaMatch = pool.find(item => (item.persona_alignment || []).includes(personaBase));
    return personaMatch || pool[0];
}

// Applies the deterministic, code-enforced size_modifiers.json rules on top of a persona's base
// furniture piece list: drops roles that don't physically fit, overrides dimensions for roles that
// need capping at this size, and appends genuine space-saving additions. This must never be left to
// GPT/enrichment layers — these are hard architectural facts (island thresholds, clearances), not
// stylistic choices.
function applySizeModifiers(basePieces, sizeMod) {
    if (!basePieces) return basePieces;
    let pieces = basePieces.slice();
    const excludeSet = new Set(sizeMod.exclude_roles || []);
    pieces = pieces.filter(p => !excludeSet.has(p.role));
    if (sizeMod.dimension_overrides) {
        pieces = pieces.map(p => sizeMod.dimension_overrides[p.role] ? Object.assign({}, p, { dimensions: sizeMod.dimension_overrides[p.role] }) : p);
    }
    if (sizeMod.add_pieces && sizeMod.add_pieces.length) {
        pieces = pieces.concat(sizeMod.add_pieces);
    }
    return pieces;
}

// Builds a real, catalog-backed procurement list (Page 7) instead of the old 2-item generic
// fallback — one real product per distinct role available for this room, persona-matched where
// possible, reshaped into the {item, brand, cost, benefit, link} shape the Page 7 renderer expects.
function buildCatalogProcurementList(catalog, roomType, personaBase, sizeKey, limit) {
    const rolesInRoom = Array.from(new Set((catalog.furniture || []).filter(item => (item.room_alignment || []).includes(roomType)).map(item => item.role)));
    const picked = rolesInRoom
        .map(role => findRealProduct(catalog, roomType, role, personaBase, sizeKey))
        .filter(Boolean)
        .slice(0, limit || 6);
    return picked.map(product => ({
        item: product.name,
        brand: product.tag || 'Curated match',
        cost: product.price_range,
        benefit: product.why,
        link: product.link
    }));
}

function buildTechnicalProtocolHtml(constraints) {
    if (!constraints) return '';
    const listItems = (arr) => (arr || []).map(item => `<li style="margin-bottom: 5px; line-height: 1.4;">${escapeHtml(item)}</li>`).join('');
    return `
    <div class="technical-protocol-block" style="margin-bottom: 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px;">
      <div style="font-family: 'DM Mono', monospace; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent-soft); font-weight: bold; margin-bottom: 6px;">Technical Protocol — size-specific constraints</div>
      ${constraints.hard_rules && constraints.hard_rules.length ? `<div style="font-size: 8.5pt; margin-bottom: 6px;"><strong>Hard rules:</strong><ul style="margin: 4px 0 0 16px; padding: 0;">${listItems(constraints.hard_rules)}</ul></div>` : ''}
      ${constraints.space_saving_tips && constraints.space_saving_tips.length ? `<div style="font-size: 8.5pt; margin-bottom: 6px;"><strong>Space-saving moves:</strong><ul style="margin: 4px 0 0 16px; padding: 0;">${listItems(constraints.space_saving_tips)}</ul></div>` : ''}
      ${constraints.avoid && constraints.avoid.length ? `<div style="font-size: 8.5pt;"><strong>Avoid:</strong><ul style="margin: 4px 0 0 16px; padding: 0;">${listItems(constraints.avoid)}</ul></div>` : ''}
    </div>`;
}

async function compileDossier() {
    const config = parseArgs();
    console.log('=== Starting Parametric Spatial Dossier Compiler ===');
    console.log(`- Persona:      ${config.persona.toUpperCase()}`);
    console.log(`- Room Type:    ${config.room_type.toUpperCase()}`);
    console.log(`- Room Size:    ${config.room_size.toUpperCase()}`);
    console.log(`- Occupancy:    ${config.occupancy.toUpperCase()}`);
    console.log(`- Pets Present: ${config.pets ? 'YES' : 'NO'}\n`);

    // Load JSON databases
    if (!fs.existsSync(path.join(DATA_DIR, 'personas.json'))) {
        console.error('Error: personas.json database not found.');
        process.exit(1);
    }
    const personas = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'personas.json'), 'utf8'));
    const occupancyModifiersPath = path.join(DATA_DIR, 'occupancy_modifiers.json');
    if (!fs.existsSync(occupancyModifiersPath)) {
        console.error('Error: occupancy_modifiers.json database not found.');
        process.exit(1);
    }
    const occupancyModifiers = JSON.parse(fs.readFileSync(occupancyModifiersPath, 'utf8'));
    const roomDetailsMatrixPath = path.join(DATA_DIR, 'room_details_matrix.json');
    if (!fs.existsSync(roomDetailsMatrixPath)) {
        console.error('Error: room_details_matrix.json database not found.');
        process.exit(1);
    }
    const roomDetailsMatrix = JSON.parse(fs.readFileSync(roomDetailsMatrixPath, 'utf8'));
    const painModifiersPath = path.join(DATA_DIR, 'pain_modifiers.json');
    if (!fs.existsSync(painModifiersPath)) {
        console.error('Error: pain_modifiers.json database not found.');
        process.exit(1);
    }
    const painModifiers = JSON.parse(fs.readFileSync(painModifiersPath, 'utf8'));
    const protocolsDB = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'protocols_db.json'), 'utf8'));
    const diagnosisRules = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'diagnosis_rules.json'), 'utf8'));
    const plantsProducts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'plants_products.json'), 'utf8'));
    const materialsMatrixPath = path.join(DATA_DIR, 'materials_matrix.json');
    const materialsMatrix = fs.existsSync(materialsMatrixPath) ? JSON.parse(fs.readFileSync(materialsMatrixPath, 'utf8')) : {};
    const diagnosisRoomModifiersPath = path.join(DATA_DIR, 'diagnosis_room_modifiers.json');
    const diagnosisRoomModifiers = fs.existsSync(diagnosisRoomModifiersPath) ? JSON.parse(fs.readFileSync(diagnosisRoomModifiersPath, 'utf8')) : {};
    const furnitureRecommendationsPath = path.join(DATA_DIR, 'furniture_recommendations.json');
    const furnitureRecommendations = fs.existsSync(furnitureRecommendationsPath) ? JSON.parse(fs.readFileSync(furnitureRecommendationsPath, 'utf8')) : {};
    const roomConstraintsPath = path.join(DATA_DIR, 'room_constraints.json');
    const roomConstraints = fs.existsSync(roomConstraintsPath) ? JSON.parse(fs.readFileSync(roomConstraintsPath, 'utf8')) : {};
    const sizeModifiersPath = path.join(DATA_DIR, 'size_modifiers.json');
    const sizeModifiersDB = fs.existsSync(sizeModifiersPath) ? JSON.parse(fs.readFileSync(sizeModifiersPath, 'utf8')) : {};
    const roomMaterialNotesPath = path.join(DATA_DIR, 'room_material_notes.json');
    const roomMaterialNotes = fs.existsSync(roomMaterialNotesPath) ? JSON.parse(fs.readFileSync(roomMaterialNotesPath, 'utf8')) : {};
    const matrixExtractedPath = path.join(DATA_DIR, 'matrix_extracted.json');
    const matrixExtracted = fs.existsSync(matrixExtractedPath) ? JSON.parse(fs.readFileSync(matrixExtractedPath, 'utf8')) : null;

    const personaProfile = personas[config.persona];
    if (!personaProfile) {
        console.error(`Error: Persona "${config.persona}" not defined in personas.json`);
        process.exit(1);
    }

    let modifiersKey = 'just_me';
    if (config.occupancy === 'couple' || config.occupancy === 'partner') {
        modifiersKey = 'me_plus_someone';
    } else if (config.occupancy === 'family') {
        modifiersKey = 'different_rhythms';
    } else if (config.occupancy === 'solo') {
        modifiersKey = config.pets ? 'me_plus_pet' : 'just_me';
    }
    const activeModifiers = occupancyModifiers[modifiersKey] || occupancyModifiers.just_me;

    const diagKey = `${config.persona}_${config.room_size}`;
    const diagnosis = diagnosisRules[diagKey] || {
        brutal_observation: "The layout contains visual ambiguity and spatial friction. Adjustments are required to align physical elements with psychological comfort.",
        what_is_causing_this: [
            "Circulation lines slice directly through private seating quadrants.",
            "Horizontal utility surfaces are experiencing visual overload.",
            "Visual anchors fail to delineate multiple competing functions."
        ],
        stress_indicators: { "visual_noise": 6.5, "command_deficit": 6.0, "zone_ambiguity": 5.8, "size_pressure": 5.0 }
    };

    // Override brutal observation from the persona-matrix.html challenge if present!
    if (matrixExtracted && 
        matrixExtracted[config.persona] && 
        matrixExtracted[config.persona][config.room_type]) {
        const customChallenge = matrixExtracted[config.persona][config.room_type].challenge;
        if (customChallenge) {
            diagnosis.brutal_observation = customChallenge;
        }
    }

    // Override brutal observation from the pain modifiers database if present!
    if (painModifiers && painModifiers.pain_details && painModifiers.pain_details[config.pain]) {
        const customBrutal = painModifiers.pain_details[config.pain].diagnoses?.[config.persona];
        if (customBrutal) {
            diagnosis.brutal_observation = customBrutal;
        }
    }

    const areaMap = { micro: 9, tight: 12, compact: 16, standard: 20, generous: 26, large: 35 };
    const area_m2 = areaMap[config.room_size] || 20;

    // A. Resolve Base and Isometric Drawing paths
    const gorkeSize = config.room_size === 'standard' ? 'standart' : config.room_size;
    const gorkeRoom = config.room_type === 'balcony' ? 'balcony' : 'room';
    
    const basePlanFile = `${gorkeSize}_${gorkeRoom}.png`;
    const isometricPlanFile = `${gorkeSize}_${gorkeRoom}_isometric.png`;
    
    const fullPlanPath = path.join(EMPTY_PNG_DIR, basePlanFile);
    const fullIsometricPath = path.join(EMPTY_PNG_DIR, isometricPlanFile);
    
    // Load matching base64 graphic previews
    const rawPlanBuffer = fs.existsSync(fullPlanPath) ? fs.readFileSync(fullPlanPath) : fs.readFileSync(path.join(EMPTY_PNG_DIR, 'standart_room.png'));
    const base64PlanImg = `data:image/png;base64,${rawPlanBuffer.toString('base64')}`;
    
    const rawIsometricBuffer = fs.existsSync(fullIsometricPath) ? fs.readFileSync(fullIsometricPath) : fs.readFileSync(path.join(EMPTY_PNG_DIR, 'standart_room_isometric.png'));
    const base64IsometricImg = `data:image/png;base64,${rawIsometricBuffer.toString('base64')}`;

    // B. Resolve Dynamic SVG Overlays
    const beforeSvgOverlay = generateSVGOverlay(config.persona, config.room_size, false);
    const afterSvgOverlay = generateSVGOverlay(config.persona, config.room_size, true);

    // C. Resolve dynamic color tokens
    const colors = personaProfile.theme_colors;
    const dynamicStyles = `
        :root {
            --accent: ${colors.accent};
            --accent-soft: ${colors.accent_soft};
            --accent-rgb: ${hexToRgbParts(colors.accent)};
            --paper-a: ${colors.paper_a};
            --paper-b: ${colors.paper_b};
            --paper-c: ${colors.paper_c};
            --ink: #faf8f4;
            --rule: rgba(255, 255, 255, 0.05);
        }
    `;

    // D. Build dynamic stress indicators HTML
    // Room-priority modifier (diagnosis_room_modifiers.json, added 2026-07-14): flags which
    // stress indicator matters most for THIS room type, so the size-based diagnosis (persona x
    // size only) gets a room-aware lens without needing a full persona x size x room matrix.
    const roomMod = diagnosisRoomModifiers[config.room_type] || null;
    let stressHTML = '<div class="scale-note">Scored <strong>0-10</strong> from quiz responses. <strong>7.0+</strong> requires immediate correction; <strong>4.0-6.9</strong> is addressed by the layout plan.</div>';
    for (const [key, val] of Object.entries(diagnosis.stress_indicators)) {
        const formattedLabel = labelFromKey(key);
        const warnClass = Number(val) >= 7 ? '' : ' warn';
        const isRoomPriority = roomMod && key === roomMod.priority_stress;
        stressHTML += `
            <div class="stress-row">
              <div class="sr-label">${formattedLabel}${isRoomPriority ? ' <span style="color:var(--accent); font-size:0.85em; text-transform:uppercase; letter-spacing:0.5px;">(room priority)</span>' : ''}</div>
              <div class="sr-track"><div class="sr-fill${warnClass}" style="width: ${Math.min(100, val * 10)}%"></div></div>
              <div class="sr-val${warnClass}">${val.toFixed(1)}</div>
            </div>
        `;
    }
    if (roomMod) {
        stressHTML += `<div class="scale-note" style="margin-top:8px; color:var(--accent); font-style:italic;">${roomMod.context}</div>`;
    }

    // E. Resolve active persona values & details
    const VARIANT_SUFFIX_MAP = {
        sovereign: { variantA: 'clinical', variantB: 'precision' },
        sage: { variantA: 'hermit', variantB: 'scholar' },
        alchemist: { variantA: 'fluid', variantB: 'chaotic' },
        weaver: { variantA: 'intimate', variantB: 'dynamic' }
    };
    let suffix = 'clinical';
    if (config.variant) {
        if (config.variant === 'variantA' || config.variant === 'variantB') {
            suffix = VARIANT_SUFFIX_MAP[config.persona]?.[config.variant] || 'clinical';
        } else {
            suffix = config.variant.toLowerCase();
        }
    }
    const pDetails = DESIGN_LANGUAGES[config.persona];
    const principles = DESIGN_PRINCIPLES[config.persona];

    const personaVariantKey = `${config.persona}_${suffix}`;
    const roomData = roomDetailsMatrix[config.room_type] || roomDetailsMatrix['living_room'];
    const variantData = roomData[personaVariantKey] || roomData['sovereign_clinical'];
    let materialsProfile = materialsMatrix[personaVariantKey] || null;
    const roomMaterialNote = roomMaterialNotes[config.room_type] || null;
    // Balcony is weather-exposed — materials_matrix.json is persona-only and defaults to indoor
    // finishes (lacquer, wool, veneer) that don't survive outdoors. Swap in weatherproof
    // equivalents while keeping the persona's color family intact.
    if (roomMaterialNote && config.room_type === 'balcony' && materialsProfile) {
        materialsProfile = Object.assign({}, materialsProfile, {
            primary_material: roomMaterialNote.primary_material_override || materialsProfile.primary_material,
            textile: roomMaterialNote.textile_override || materialsProfile.textile,
            metal_hardware: roomMaterialNote.hardware_override || materialsProfile.metal_hardware
        });
    }
    // Studio holds two zones (sleep + activity) in one room — a single flat palette works against
    // zone separation, so we surface a livelier per-persona accent color specifically for marking
    // one zone, on top of (not replacing) the shared base palette.
    const studioZoneAccent = (config.room_type === 'studio' && roomMaterialNote) ? (roomMaterialNote.zone_accents || {})[personaVariantKey] : null;
    const studioZoneNote = (config.room_type === 'studio' && roomMaterialNote) ? roomMaterialNote.zone_note : null;

    const thirdKeyMap = {
        living_room: 'dining',
        kitchen: 'dining',
        bedroom: 'nightstand',
        balcony: 'dining',
        studio: 'work',
        open_plan: 'dining',
        home_office: 'chair'
    };
    const thirdKey = thirdKeyMap[config.room_type] || 'dining';

    let detailLighting = variantData.lighting || '';
    let detailGeometry = (variantData.geometry || '') + (activeModifiers.geometry_override ? `<br><span style="display:block; margin-top:6px; color:var(--accent); font-style:italic; font-size:0.95em;">${activeModifiers.geometry_override}</span>` : '');
    const detailDining = variantData[thirdKey] || '';
    let detailStorage = (variantData.storage || '') + (activeModifiers.storage_override ? `<br><span style="display:block; margin-top:6px; color:var(--accent); font-style:italic; font-size:0.95em;">${activeModifiers.storage_override}</span>` : '');
    let detailDurability = activeModifiers.durability_override || '';
    // Material palette (materials_matrix.json, added 2026-07-14): appended to the durability/finish
    // line since there's no dedicated template slot for it yet — reuses the existing italic-accent
    // pattern rather than requiring a new template section.
    if (materialsProfile) {
        const paletteNames = (materialsProfile.palette || []).map(c => c.name).join(', ');
        detailDurability += `<br><span style="display:block; margin-top:6px; color:var(--accent); font-style:italic; font-size:0.95em;">Material palette: ${materialsProfile.primary_material}; ${materialsProfile.textile}. Tones: ${paletteNames}. Avoid: ${(materialsProfile.avoid || []).slice(0, 2).join(', ')}.</span>`;
    }

    // Page 11 - Furniture Recommendation (furniture_recommendations.json, updated 2026-07-14 to
    // hold 3-5 pieces per room x persona-variant instead of a single anchor item, per explicit
    // user request). Each piece supplies type/shape/dimensions; material/color (materialsProfile)
    // and placement (room_details_matrix.json's variantData.geometry) are genuinely shared across
    // every piece in the room for a given persona-variant, so they're rendered once below the
    // per-piece table rather than repeated on every row — avoids duplicating the same material/
    // color/placement text 3-5 times on one page.
    const furniturePiecesBase = (furnitureRecommendations[config.room_type] || {})[personaVariantKey] || null;
    const sizeMod = (sizeModifiersDB[config.room_type] || {})[config.room_size] || {};
    const roomConstraintEntry = (roomConstraints[config.room_type] || {})[config.room_size] || null;
    const furniturePieces = applySizeModifiers(furniturePiecesBase, sizeMod);
    let furnitureRecommendationHtml;
    if (furniturePieces && furniturePieces.length > 0) {
        const colorNames = materialsProfile ? (materialsProfile.palette || []).map(c => c.name).join(', ') : 'See material palette on the previous page.';
        const materialText = materialsProfile ? `${materialsProfile.primary_material}; secondary: ${materialsProfile.secondary_material}; textile: ${materialsProfile.textile}; hardware: ${materialsProfile.metal_hardware}` : 'See material palette on the previous page.';
        const placementText = variantData.geometry || 'Position according to the Spatial Geometry specification on the previous page.';
        const technicalProtocolHtml = buildTechnicalProtocolHtml(roomConstraintEntry);
        const pieceRows = furniturePieces.map(piece => {
            const realProduct = findRealProduct(plantsProducts, config.room_type, piece.role, config.persona, config.room_size);
            const realProductLine = realProduct
                ? `<div style="margin-top:3px; font-size: 7.5pt;"><a href="${realProduct.link}" target="_blank" style="color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent-soft);">${escapeHtml(realProduct.name)}</a> · ${escapeHtml(realProduct.price_range)}</div>`
                : '';
            return `
                <tr>
                  <td class="specs-label">${escapeHtml(piece.role || piece.type)}</td>
                  <td class="specs-val">${escapeHtml(piece.type)}${realProductLine}</td>
                  <td class="specs-val">${escapeHtml(piece.shape)}</td>
                  <td class="specs-val">${escapeHtml(piece.dimensions)}</td>
                </tr>`;
        }).join('');
        furnitureRecommendationHtml = `
            ${technicalProtocolHtml}
            <div class="furniture-tagline">${furniturePieces.length} recommended pieces — ${escapeHtml(config.room_type.replace(/_/g, ' '))} · ${escapeHtml(personaProfile.display_name || config.persona)} (${escapeHtml(suffix)})${sizeMod.size_note ? ' — ' + escapeHtml(sizeMod.size_note) : ''}</div>
            <table class="specs-table">
              <thead><tr><th style="width: 22%;">Piece</th><th style="width: 26%;">Type / Real Product</th><th style="width: 32%;">Shape</th><th style="width: 20%;">Dimensions</th></tr></thead>
              <tbody>${pieceRows}
              </tbody>
            </table>
            <table class="specs-table" style="margin-top: 10px;">
              <tbody>
                <tr><td class="specs-label" style="width: 25%;">Material & Color</td><td class="specs-val">${escapeHtml(materialText)}. Tones: ${escapeHtml(colorNames)}.</td></tr>
                <tr><td class="specs-label">Placement</td><td class="specs-val">${escapeHtml(placementText)}</td></tr>
              </tbody>
            </table>
        `;
    } else {
        furnitureRecommendationHtml = `<p style="font-size: 8.5pt; color: var(--mid);">No dedicated furniture recommendation is available yet for this room/persona combination — refer to the Materiality & Lighting page for material and color guidance.</p>`;
    }

    // Pain point spec injection on Page 8
    const painSpec = resolvePainSpec(config.pain);
    if (painSpec) {
        if (painSpec.field === 'lighting') {
            detailLighting += `<br><span style="display:block; margin-top:6px; color:var(--accent); font-style:italic; font-size:0.95em;">${painSpec.text}</span>`;
        } else if (painSpec.field === 'geometry') {
            detailGeometry += `<br><span style="display:block; margin-top:6px; color:var(--accent); font-style:italic; font-size:0.95em;">${painSpec.text}</span>`;
        } else if (painSpec.field === 'storage') {
            detailStorage += `<br><span style="display:block; margin-top:6px; color:var(--accent); font-style:italic; font-size:0.95em;">${painSpec.text}</span>`;
        }
    }

    let priorityActionsList = variantData.first_3_steps || [];
    if (painModifiers && painModifiers.pain_details && painModifiers.pain_details[config.pain]) {
        const customActions = painModifiers.pain_details[config.pain].priority_actions?.[config.persona];
        if (customActions && customActions.length > 0) {
            priorityActionsList = customActions;
        }
    }
    const priorityActionsHtml = priorityActionsList
        .slice(0, 3)
        .map((step, idx) => `<li style="margin-bottom: 6px; line-height: 1.45;">${escapeHtml(step)} <span style="color:var(--faint);">(scheduled as Day ${idx === 0 ? 2 : idx === 1 ? 3 : 5})</span></li>`)
        .join('');

    const aiEnrichment = await fetchAiEnrichment(config, {
        persona: config.persona,
        variant: suffix,
        room_type: config.room_type,
        room_size: config.room_size,
        occupancy: config.occupancy,
        pain: config.pain,
        pets: config.pets,
        area_m2,
        style: pDetails.style,
        diagnosis: diagnosis.brutal_observation,
        priority_actions: priorityActionsList
    });
    const prescription = buildPrescriptionContent({
        config,
        pDetails,
        diagnosis,
        activeModifiers,
        priorityActionsList,
        area_m2,
        aiEnrichment
    });
    const generatedVisual = await generateOpenAiConceptImage(config, prescription.visualPrompt);
    const coverVisualHtml = buildCoverVisualHtml(generatedVisual, base64IsometricImg);
    const photoAuditPagesHtml = buildPhotoAuditPages(config, aiEnrichment, generatedVisual);
    const anchorPiece = furniturePieces?.[0];
    const furnitureContextHtml = `
      <div class="concept-context">
        <div class="concept-context-media">${coverVisualHtml}</div>
        <div class="concept-context-copy">
          <div><div class="visual-module-kicker" style="margin-bottom:8px;">Anchor in context</div><div class="concept-context-title">${escapeHtml(anchorPiece?.type || 'Primary furniture anchor')}</div></div>
          <div class="concept-context-meta">${escapeHtml(anchorPiece?.dimensions || 'Verify against the clearance plan')}<br>${escapeHtml(config.room_type.replace(/_/g, ' '))}<br>${escapeHtml(personaProfile.display_name || config.persona)} / ${escapeHtml(suffix)}</div>
        </div>
      </div>`;

    // Build Page 2 Philosophy HTML
    const stylePhilosophyHtml = `
      <div class="philo-grid">
        <div class="philo-card accent">
          <div class="philo-label">Intervention Style</div>
          <div class="philo-title">${pDetails.style}</div>
          <div class="philo-text">
            <strong>Approach:</strong> ${pDetails.approach}<br><br>
            <strong>Sensory Feel:</strong> ${pDetails.feel}<br><br>
            <strong>Spatial Literacy:</strong> ${pDetails.literacy}
          </div>
        </div>
        
        <div class="philo-card">
          <div class="philo-label">Market Counterpart Contrast</div>
          <div class="philo-title">Commercial vs. Custom</div>
          <div class="philo-text">
            ${pDetails.diff}
          </div>
        </div>
      </div>
    `;

    // Build Page 3 Hierarchy Rules HTML
    const styleHierarchyHtml = principles.map((p, idx) => `
      <div class="rule-item">
        <div class="rule-num">0${idx + 1}</div>
        <div>
          <div class="rule-title">${p.title}</div>
          <div class="rule-text">${p.text}</div>
        </div>
      </div>
    `).join('');
    const hierarchyVisualHtml = `
      <div class="visual-module">
        <div class="visual-module-head"><div class="visual-module-kicker">Hierarchy strength map</div><div class="visual-module-note">Read from dominant anchor to supporting detail</div></div>
        <div class="hierarchy-bars">${principles.map((p, idx) => `
          <div class="hierarchy-bar-row">
            <span style="font-family:'DM Mono',monospace;color:var(--accent);">0${idx + 1}</span>
            <span style="color:var(--ink);">${escapeHtml(p.title)}</span>
            <div class="hierarchy-track"><div class="hierarchy-fill" style="width:${100 - idx * 9}%;opacity:${0.94 - idx * 0.08};"></div></div>
            <span style="font-family:'DM Mono',monospace;color:var(--mid);">${100 - idx * 9}</span>
          </div>`).join('')}</div>
      </div>`;

    const palette = (materialsProfile?.palette || [
        { name: 'Primary', hex: '#8d6547' },
        { name: 'Ground', hex: '#d2c4b3' },
        { name: 'Anchor', hex: '#302821' }
    ]).slice(0, 3);
    if (studioZoneAccent) palette.push(studioZoneAccent);
    const materialPaletteHtml = `
      <div class="visual-module">
        <div class="visual-module-head"><div class="visual-module-kicker">Material evidence board</div><div class="visual-module-note">Use these finishes as a controlled family, not isolated samples</div></div>
        <div class="material-board">
          <div class="palette-stack">${palette.map(color => `<div class="palette-chip" style="background:${escapeHtml(color.hex)};"><span class="palette-chip-name">${escapeHtml(color.name)}<br>${escapeHtml(color.hex)}</span></div>`).join('')}</div>
          <div class="material-ledger">
            <div class="material-sample"><strong>Primary body</strong><span>${escapeHtml(materialsProfile?.primary_material || 'Low-sheen continuous surfaces with controlled grain.')}</span></div>
            <div class="material-sample"><strong>Touch layer</strong><span>${escapeHtml(materialsProfile?.textile || 'Durable tactile textile in one quiet tonal family.')}</span></div>
            <div class="material-sample"><strong>Hardware rule</strong><span>${escapeHtml(materialsProfile?.metal_hardware || 'Keep hardware visually subordinate to the furniture volume.')}</span></div>
            ${roomMaterialNote && config.room_type === 'balcony' ? `<div class="material-sample"><strong>Weatherproofing</strong><span>${escapeHtml(roomMaterialNote.override_note)}</span></div>` : ''}
            ${studioZoneAccent ? `<div class="material-sample"><strong>Zone accent — ${escapeHtml(studioZoneAccent.name)}</strong><span>${escapeHtml(studioZoneNote)}</span></div>` : ''}
          </div>
        </div>
      </div>`;

    // F. Build Page 5 Clearance Standards Table HTML
    const circMod = activeModifiers.circulation_modifier || 0;
    const isTiny = (config.room_type === 'studio' || config.room_type === 'bedroom' || config.room_type === 'balcony');
    const baseSpecs = isTiny 
        ? [
            { label: "Active Chair Pull-back", min: 75, type: "proximity", desc: "Minimum clearance behind work desks to allow seating transit without blocking primary corridors." },
            { label: "Circulation Corridor", min: 65, type: "corridor", desc: "Absolute minimum width for secondary pathways between furniture edges and walls." },
            { label: "Doorway Swing Radius", min: 85, type: "proximity", desc: "Unobstructed arc required for primary entry doors to maintain structural safety zones." },
            { label: "Surface Contact Depth", min: 50, type: "proximity", desc: "Recommended maximum protrusion depth for floating cabinets to protect movement paths." }
        ]
        : [
            { label: "Transit Flow Pathway", min: 90, type: "corridor", desc: "The entry-to-window path stays wide enough to walk without turning your shoulders." },
            { label: "Reading Circle", min: 120, type: "proximity", desc: "Chair-to-seat distance keeps the corner private without isolating it." },
            { label: "Sofa Boundary Float", min: 60, type: "proximity", desc: "The primary seat pulls off the wall so the room reads as composed space, not stored furniture." },
            { label: "Low Table Access Gate", min: 45, type: "proximity", desc: "Leg clearance between table edge and seat: you sit down without choreography." }
        ];

    const clearance = {
        title: isTiny ? "Compact Footprint Clearance Tolerances" : "Clearance Targets (Neufert + room meaning)",
        specs: baseSpecs.map(spec => {
            let val = spec.min;
            let suffixText = "";
            if (circMod > 0) {
                const addCm = (spec.type === 'corridor' ? circMod * 10 : circMod * 5);
                val += addCm;
                suffixText = ` (includes +${addCm}cm ${activeModifiers.label} clearance)`;
            }
            return {
                label: spec.label,
                min: `${val} cm${suffixText}`,
                desc: spec.desc
            };
        })
    };

    const clearancesTableHtml = clearance.specs.map(spec => `
      <tr>
        <td style="font-weight: 500; color: var(--ink);">${spec.label}</td>
        <td style="font-family: var(--font-mono); color: var(--accent); font-weight: bold; white-space: nowrap;">${spec.min}</td>
        <td>${spec.desc}</td>
      </tr>
    `).join('');

    // G. Build Page 6 Functional Zoning HTML
    let roomZones = ZONES_DATA[config.room_type] || ZONES_DATA.bedroom;
    if (config.room_type === 'living_room' && config.pain === 'storage') {
        roomZones = [
            { name: 'Command Seat & Conversation', pct: 0.50, personas: 'Sovereign 80% | Sage 20%', rationale: 'One primary two-seat sofa floated off the rear wall and aimed toward the entry axis. The room receives a single command point instead of several competing object clusters.' },
            { name: 'Concealment Wall', pct: 0.31, personas: 'Sovereign 90% | Sage 10%', rationale: 'One flush closed-storage line absorbs the open-shelf clutter that created the diagnosis. Media, utility, cables, and daily loose items move behind one calm surface.' },
            { name: 'Window Reading Corner', pct: 0.19, personas: 'Sage 70% | Sovereign 30%', rationale: 'One chair, one 2700K floor lamp, one single-person reward zone. It is not extra seating; it is the payoff for reducing visual noise.' }
        ];
    }
    const functionalZoningHtml = roomZones.map((z, idx) => {
        const zoneArea = (area_m2 * z.pct).toFixed(1);
        const zonePctLabel = Math.round(z.pct * 100);
        return `
            <div class="zoning-card">
              <div class="zc-header">
                <div class="zc-title">Zone 0${idx + 1}: ${z.name}</div>
                <div class="zc-area">${zoneArea} m² / ${zonePctLabel}%</div>
              </div>
              <div class="zc-personas">Persona Split: ${z.personas}</div>
              <div class="zc-rationale">${z.rationale}</div>
            </div>
        `;
    }).join('');
    const zoningDiagramHtml = `
      <div class="visual-module">
        <div class="visual-module-head"><div class="visual-module-kicker">Area allocation diagram</div><div class="visual-module-note">${area_m2} m2 working footprint</div></div>
        <div class="zone-map">
          ${roomZones.slice(0, 3).map((zone, idx) => `<div class="${idx === 0 ? 'zone-primary' : idx === 1 ? 'zone-secondary' : 'zone-tertiary'}"><div><div class="visual-module-kicker">Zone 0${idx + 1}</div><div class="zone-map-name">${escapeHtml(zone.name)}</div></div><div><div class="zone-map-pct">${Math.round(zone.pct * 100)}%</div><div class="visual-module-note">${(area_m2 * zone.pct).toFixed(1)} m2 assigned</div></div></div>`).join('')}
        </div>
      </div>`;

    // H. Build Page 7 Procurement List HTML
    const procurementKey = `${config.persona}_${suffix}`;
    const procurementList = plantsProducts.furniture || []; // In dossier generator, we query from products DB
    
    // Hardcoded fallback list if needed
    const fallbackProcurement = {
        sovereign_clinical: [
            { item: "Stainless Steel Linear Desk Organizer", brand: "Daiso Industrial", cost: "$24", benefit: "Enforces surface discipline and eliminates wire clutter." },
            { item: "Brushed Aluminum Recessed Spotlight", brand: "Philips LED", cost: "$45", benefit: "Creates narrow, high-contrast directional light pools." }
        ],
        sovereign_precision: [
            { item: "Millimetric Symmetrical Grid Shelving Unit", brand: "IKEA / Vitsoe", cost: "$89", benefit: "Provides absolute visual alignment grids for objects." }
        ]
    };
    let activeProcurementList = [];
    if (painModifiers && painModifiers.pain_details && painModifiers.pain_details[config.pain]) {
        activeProcurementList = painModifiers.pain_details[config.pain].procurement || [];
    }
    if (config.pain === 'storage') {
        activeProcurementList = [
            { item: 'Opaque Storage Boxes with Integrated Lid x6', brand: 'IKEA KUGGIS or equal', cost: '$72', benefit: 'Encloses shelf clutter in uniform closed volumes.', day: 'Day 2 dependency' },
            { item: 'Under-Furniture Cable Management Tray x2', brand: 'D-Line / IKEA SIGNUM', cost: '$38', benefit: 'Clears wire chaos below the media line.', day: 'Day 5 dependency' },
            { item: 'Push-to-Open Door Hardware Set', brand: 'BLUM TIP-ON or equal', cost: '$34', benefit: 'Converts storage fronts to handle-free, zero-noise surfaces.', day: 'Day 3 dependency' },
            { item: '2700K Dimmable Floor Lamp', brand: 'Shaded, CRI 90+', cost: '$45', benefit: 'Anchors the reading corner and passes the night test.', day: 'Day 4 dependency' },
            { item: 'Low-Pile Rug 160x230', brand: 'Single tone, no pattern', cost: 'Optional', benefit: 'Draws the command zone boundary on the floor instead of adding furniture.', day: 'Buy only after Day 7' },
            { item: '3000K Wall-Washer Pair', brand: 'Plug-in, asymmetric beam', cost: '$25', benefit: 'Perimeter glow that replaces the ceiling flood.', day: 'Day 6 dependency' }
        ];
    } else if (activeProcurementList.length === 0) {
        const catalogList = buildCatalogProcurementList(plantsProducts, config.room_type, config.persona, config.room_size, 6);
        activeProcurementList = catalogList.length > 0 ? catalogList : (fallbackProcurement[procurementKey] || [
            { item: "Acoustic Felt Wall Panel Grid", brand: "Sound Assured", cost: "$39", benefit: "Dampens sound reflections to secure a silent sanctuary." },
            { item: "Dimmable warm task floor lamp", brand: "Globe Electric", cost: "$59", benefit: "Restricts illumination strictly to reading task cones." }
        ]);
    }

    let procurementTableHtml = activeProcurementList.map((item, idx) => {
        const displayName = item.link ? `<a href="${item.link}" target="_blank" style="color: #fff; text-decoration: none; border-bottom: 1px dotted var(--mid);">${item.item}</a>` : item.item;
        return `
        <div class="product-item">
            <div class="pi-num">0${idx + 1}</div>
            <div class="pi-body">
                <div class="pi-name">${displayName}</div>
                <div class="pi-reason">Correction spec: <strong>${item.brand}</strong>${item.day ? ' | ' + item.day : ''}.</div>
            </div>
            <div class="pi-cost">${item.cost}</div>
            <div class="pi-benefit">${item.benefit}</div>
        </div>
        `;
    }).join('');
    if (config.pain === 'storage') {
        procurementTableHtml += `<div class="dont-buy-box"><div class="db-title">What NOT to buy - storage overload edition</div><ul><li><strong>No open shelving units</strong> - they recreate the diagnosis.</li><li><strong>No second coffee table or side-table set</strong> - every new surface becomes a new storage failure.</li><li><strong>No decorative storage</strong> - visible storage is still visual noise.</li><li><strong>No larger sofa</strong> - it erases the protected transit path.</li></ul></div>`;
    }

    // I. Build Page 9 Plant Recommendations (Pet safety filter applied dynamically)
    const recommendedPlants = plantsProducts.plants.filter(plant => {
        const matchesPersona = plant.persona_alignment.includes(config.persona);
        if (!matchesPersona) return false;
        if (config.pets && plant.safety !== 'safe') return false; // Filter out risk plants
        return true;
    }).slice(0, 2);

    const plantsHTML = recommendedPlants.map(plant => `
        <div class="plant-card">
          <div class="plant-meta">
            <div class="plant-name-row">
              <span class="plant-common">${plant.name}<span class="plant-sci">${plant.sci}</span></span>
              <span class="${plant.safety === 'safe' ? 'plant-safety-safe' : 'plant-safety-risk'}">${plant.safety.toUpperCase()}</span>
            </div>
            <div class="plant-desc">${plant.why}</div>
          </div>
          <div style="display: flex; flex-direction: column; justify-content: center; border-left: 1px solid var(--rule); padding-left: 14px;">
            <div class="plant-specs-row">
              <div class="ps-col"><span class="ps-lbl">Light</span><br>${plant.light}</div>
              <div class="ps-col"><span class="ps-lbl">Water</span><br>${plant.water}</div>
            </div>
          </div>
        </div>
    `).join('');
    const plantPlacementHtml = `
      <div class="visual-module">
        <div class="visual-module-head"><div class="visual-module-kicker">Placement, not decoration</div><div class="visual-module-note">Plants remain outside the protected circulation axis</div></div>
        <div class="plant-plan">
          <div class="plant-plan-drawing">
            <img src="${base64PlanImg}" alt="Plant placement plan">
            <div class="plant-marker" style="left:18%;top:22%;">P1</div>
            <div class="plant-marker" style="right:16%;bottom:20%;">P2</div>
          </div>
          <div class="plant-guidance">
            ${recommendedPlants.map((plant, idx) => `<div class="plant-guidance-item"><strong>P${idx + 1} - ${escapeHtml(plant.name)}</strong><span>${idx === 0 ? 'Place near filtered daylight at the room edge; keep leaf volume above seated eye level.' : 'Use as a low secondary volume near the reading or conversation boundary, never inside the transit path.'}</span></div>`).join('')}
            <div class="plant-guidance-item"><strong>Clearance rule</strong><span>Keep pots at least 15 cm off curtain lines and 45 cm away from the principal walking route.</span></div>
          </div>
        </div>
      </div>`;

    // J. Build Page 10 Renovation Pathways HTML
    const cosmeticVal = area_m2 * 150;
    const structuralVal = area_m2 * 450;
    const structuralScope = {
        kitchen: "Demolishing partition walls, open-space integrations, custom island plumbing, integrated premium cabinetry millwork.",
        open_plan: "Acoustic boundary wall constructions, custom zoned partitions, partial structural boundary adjustments.",
        studio: "Custom sliding boundary panel installations, Murphy bed structural framing, kitchenette partition widening.",
        bedroom: "Custom floor-to-ceiling built-in wardrobe millwork, bed alcove wall framing, structural acoustic plasterboard panels.",
        balcony: "Floor tiling/screed replacement, perimeter planter masonry construction, sliding glass boundary profile installation.",
        home_office: "Custom built-in bookcase cabinetry, acoustic ceiling baffle integrations, sliding pocket door installations."
    }[config.room_type] || "Custom layout millwork, pocket door installations, and recessed structural lighting channels.";

    const pathwaysHtml = `
        <div class="pathway-card">
          <div>
            <div class="pw-label">Phase 1: Cosmetic & Layout</div>
            <div class="pw-title">Non-Demolition Execution</div>
            <div class="pw-scope">
              Reorganizing physical layout according to the blueprint, paint refinishing, light fixture mounting, local lamps placement, and surface cladding styling.
              <ul>
                <li>No structural changes</li>
                <li>Focus on surface discipline</li>
                <li>Acoustic/Tactile layering</li>
              </ul>
            </div>
          </div>
          <div class="pw-metrics">
            <div>
              <div class="pwm-val">$${cosmeticVal.toLocaleString('en-US')}</div>
              <div class="pwm-lbl">Est. Budget (USD)</div>
            </div>
            <div>
              <div class="pwm-val">2-3 Weeks</div>
              <div class="pwm-lbl">Est. Timeline</div>
            </div>
          </div>
        </div>
        
        <div class="pathway-card accent">
          <div>
            <div class="pw-label">Phase 2: Structural (Optional)</div>
            <div class="pw-title">Demolition & Custom Millwork</div>
            <div class="pw-scope">
              ${structuralScope}
              <ul>
                <li>Optimizes spatial borders</li>
                <li>Maximizes room area utility</li>
                <li>Permanent asset upgrade</li>
              </ul>
            </div>
          </div>
          <div class="pw-metrics">
            <div>
              <div class="pwm-val">$${structuralVal.toLocaleString('en-US')}</div>
              <div class="pwm-lbl">Est. Budget (USD)</div>
            </div>
            <div>
              <div class="pwm-val">5-7 Weeks</div>
              <div class="pwm-lbl">Est. Timeline</div>
            </div>
          </div>
        </div>
    `;

    // Retrieve specifications table values
    const specs = resolveSpecifications(config.persona);

    // Load static HTML framework template
    let templateHtml = fs.readFileSync(TEMPLATE_PATH, 'utf8');

    const personaLifestyleTags = {
        sovereign: "Structured Order",
        sage: "Sensory Cocoon",
        alchemist: "Kinetic Flow",
        weaver: "Social Connection"
    };
    const lifestyleLabel = personaLifestyleTags[config.persona.toLowerCase()] || "Structured Order";

    let dossierHtml = templateHtml
        .replace('<style>', `<style>${dynamicStyles}`)
        .replace(/{{CUSTOMER_NAME}}/g, escapeHtml(config.customer_name))
        .replace(/{{DELIVERY_DATE}}/g, formatDateForDossier())
        .replace(/{{DOSSIER_ID}}/g, resolveDossierId(config))
        .replace(/{{PRODUCT_TIER}}/g, config.package === '59' ? 'Photo-led Transformation - Tier 2' : 'Spatial Monograph - Tier 1')
        .replace(/{{COVER_PRODUCT_NAME}}/g, config.package === '59' ? `${config.room_type.replace(/_/g, ' ').toUpperCase()}<br>ROOM TRANSFORM` : `${config.room_type.replace(/_/g, ' ').toUpperCase()}<br>SPATIAL PRESCRIPTION`)
        .replace(/{{COVER_DESCRIPTION}}/g, config.package === '59' ? 'A photo-specific audit of visible spatial friction, paired with a controlled before/after direction and an actionable correction sequence.' : `Tailored spatial solutions to accommodate a ${lifestyleLabel} layout within ${config.room_size} bounds. Built on structured Ching and Neufert alignment standards.`)
        .replace(/{{PHOTO_AUDIT_PAGES_HTML}}/g, photoAuditPagesHtml)
        .replace(/{{ROOM_TYPE_CAPS}}/g, config.room_type.replace(/_/g, ' ').toUpperCase())
        .replace(/{{VARIANT_NAME}}/g, config.variant ? `${config.variant.toUpperCase()} Variant | #${config.room_size.toUpperCase()}-01` : `${config.persona.toUpperCase()} Variant | #${config.room_size.toUpperCase()}-01`)
        .replace(/{{PERSONA_DESC}}/g, `Tailored spatial solutions to accommodate a ${lifestyleLabel} layout within ${config.room_size} bounds. Built on structured Ching and Neufert alignment standards.`)
        .replace(/{{SPACE_TYPE}}/g, config.room_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))
        .replace(/{{SPACE_AREA}}/g, `${area_m2} m² (${config.room_size.toUpperCase()})`)
        .replace(/{{LIFESTYLE_LABEL}}/g, lifestyleLabel.toUpperCase())
        .replace(/{{RATIOS_LABEL}}/g, `${labelFromKey(config.persona)} dominant`)
        
        .replace(/{{STYLE_NAME}}/g, pDetails.style)
        .replace(/{{PRESCRIPTION_HEADLINE}}/g, prescription.headline)
        .replace(/{{PRESCRIPTION_CARDS_HTML}}/g, prescription.cardHtml)
        .replace(/{{SEVEN_DAY_PLAN_HTML}}/g, prescription.planHtml)
        .replace(/{{VISUAL_BRIEF_HTML}}/g, prescription.visualBriefHtml)
        .replace(/{{STYLE_PHILOSOPHY_HTML}}/g, stylePhilosophyHtml)
        .replace(/{{STYLE_HIERARCHY_HTML}}/g, styleHierarchyHtml)
        .replace(/{{HIERARCHY_VISUAL_HTML}}/g, hierarchyVisualHtml)
        
        .replace(/{{BASE_PLAN_IMAGE_HTML}}/g, `<img src="${base64PlanImg}" alt="Base Layout Blueprint">`)
        .replace(/{{BEFORE_SVG_OVERLAY}}/g, beforeSvgOverlay)
        .replace(/{{ISOMETRIC_IMAGE}}/g, base64IsometricImg)
        .replace(/{{COVER_VISUAL_HTML}}/g, coverVisualHtml)
        .replace(/{{ISOMETRIC_IMAGE_HTML}}/g, `<img src="${base64IsometricImg}" alt="Isometric Room Shell">`)
        
        .replace(/{{SPATIAL_TENSION}}/g, resolveSpatialTension(config.persona, config.pain))
        .replace(/{{LIFESTYLE_STRESS}}/g, (() => {
            const personaLifestyleTags = { sovereign: "Structured Order", sage: "Sensory Cocoon", alchemist: "Kinetic Flow", weaver: "Social Connection" };
            return personaLifestyleTags[config.persona.toLowerCase()] || "Structured Order";
        })())
        .replace(/{{BRUTAL_OBSERVATION}}/g, diagnosis.brutal_observation || "Visual noise coordinates exceed limits.")
        .replace(/{{STRESS_ROWS_HTML}}/g, stressHTML)
        
        .replace(/{{BLUEPRINT_IMAGE_HTML}}/g, `<img src="${base64PlanImg}" alt="Corrected Layout Blueprint">`)
        .replace(/{{AFTER_SVG_OVERLAY}}/g, afterSvgOverlay)
        
        .replace(/{{CLEARANCES_TITLE}}/g, clearance.title)
        .replace(/{{CLEARANCES_TABLE_HTML}}/g, clearancesTableHtml)
        
        .replace(/{{FUNCTIONAL_ZONING_HTML}}/g, functionalZoningHtml)
        .replace(/{{ZONING_DIAGRAM_HTML}}/g, zoningDiagramHtml)
        .replace(/{{PROCUREMENT_TABLE_HTML}}/g, procurementTableHtml)
        .replace(/{{MATERIAL_PALETTE_HTML}}/g, materialPaletteHtml)
        
        .replace(/{{DETAIL_LIGHTING}}/g, detailLighting)
        .replace(/{{DETAIL_GEOMETRY}}/g, detailGeometry)
        .replace(/{{DETAIL_DINING}}/g, detailDining)
        .replace(/{{DETAIL_STORAGE}}/g, detailStorage)
        .replace(/{{DETAIL_DURABILITY}}/g, detailDurability)
        .replace(/{{PRIORITY_ACTIONS_HTML}}/g, priorityActionsHtml)
        
        .replace(/{{PLANTS_LIST_HTML}}/g, plantsHTML)
        .replace(/{{PLANT_PLACEMENT_HTML}}/g, plantPlacementHtml)
        .replace(/{{RENOVATION_PATHWAYS_HTML}}/g, pathwaysHtml)
        .replace(/{{FURNITURE_RECOMMENDATION_HTML}}/g, furnitureRecommendationHtml)
        .replace(/{{FURNITURE_CONTEXT_HTML}}/g, furnitureContextHtml);

    let painUpsellText = "While this Spatial Monograph addresses the immediate layout modifications, a complete spatial audit delivers custom millwork elevations, exact light placement coordinates, and a full shopping list tailored specifically to your archetype.";
    if (painModifiers && painModifiers.pain_details && painModifiers.pain_details[config.pain]) {
        const customUpsell = painModifiers.pain_details[config.pain].upsell;
        if (customUpsell) {
            painUpsellText = customUpsell;
        }
    }

    const roomTransformBridgeHtml = config.package === '59' ? '' : `<div style="border:1px solid var(--accent); background:rgba(var(--accent-rgb),.07); padding:12px 14px; margin-bottom:12px; display:grid; grid-template-columns:1fr auto; gap:12px; align-items:center;"><div><div style="font-family:'Cormorant Garamond',serif; font-size:15pt; color:var(--ink); margin-bottom:4px;">See this prescription applied to your actual room</div><div style="font-size:8pt; line-height:1.55; color:var(--mid);"><strong style="color:var(--ink);">Room Transform</strong> uses one photo to locate these corrections on your real walls and returns a corrected render of your space within 48 hours.</div></div><div style="text-align:right;"><div style="font-family:'DM Mono',monospace; font-size:15pt; color:var(--accent);">$59</div><div style="font-family:'DM Mono',monospace; font-size:6pt; color:var(--mid); text-transform:uppercase;">Upgrade</div></div></div>`;

    const fitCheckHtml = `<div style="border:1px dashed var(--rule); padding:10px 12px; margin-top:12px; font-size:7.6pt; line-height:1.55; color:var(--mid);"><strong style="color:var(--ink);">Fit check:</strong> ${config.package === '59' ? 'This Room Transform is based on the submitted photograph and selected room-size band. Confirm critical dimensions, radiators, columns and fixed services before purchasing or installing.' : 'This prescription assumes the selected room-size band. If your real dimensions differ by more than +/-20%, or a radiator/column blocks a placement, reply to the delivery email with one photo. We adapt the blueprint or refund it within 7 days. Before/after permission earns 50% off Room Transform.'}</div>`;

    const bespokeUpgradeHtml = roomTransformBridgeHtml + `
<div style="font-family: 'DM Mono', monospace; font-size: 7.5pt; color: var(--accent-soft); text-transform: uppercase; font-weight: bold; letter-spacing: 0.12em; margin-bottom: 6px;">
  Upgrade to Full Spatial Audit
</div>
<div style="font-size: 8.5pt; line-height: 1.55; color: var(--ink); margin-bottom: 12px;">
  <strong>${painUpsellText}</strong> While this Spatial Monograph addresses the immediate layout modifications, a complete spatial audit delivers custom millwork elevations, exact light placement coordinates, and a full shopping list tailored specifically to your archetype.
</div>
<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: center;">
  <div style="background: rgba(255,255,255,0.01); border: 1px solid var(--rule); padding: 8px; border-radius: 4px;">
    <div style="font-family: 'DM Mono', monospace; font-size: 6pt; color: var(--mid); text-transform: uppercase;">0-60 m²</div>
    <div style="font-family: 'Cormorant Garamond', serif; font-size: 13pt; font-weight: bold; color: var(--accent); margin-top: 2px;">$1,500</div>
  </div>
  <div style="background: rgba(255,255,255,0.01); border: 1px solid var(--rule); padding: 8px; border-radius: 4px;">
    <div style="font-family: 'DM Mono', monospace; font-size: 6pt; color: var(--mid); text-transform: uppercase;">60-120 m²</div>
    <div style="font-family: 'Cormorant Garamond', serif; font-size: 13pt; font-weight: bold; color: var(--accent); margin-top: 2px;">$3,000</div>
  </div>
  <div style="background: rgba(255,255,255,0.01); border: 1px solid var(--rule); padding: 8px; border-radius: 4px;">
    <div style="font-family: 'DM Mono', monospace; font-size: 6pt; color: var(--mid); text-transform: uppercase;">120-180 m²</div>
    <div style="font-family: 'Cormorant Garamond', serif; font-size: 13pt; font-weight: bold; color: var(--accent); margin-top: 2px;">$4,500</div>
  </div>
</div>${fitCheckHtml}`;

    dossierHtml = dossierHtml.replace(/{{BESPOKE_UPGRADE_HTML}}/g, bespokeUpgradeHtml);
    assertNoUnresolvedPlaceholders(dossierHtml);

    // Write temp HTML for Puppeteer to read
    const tempHtmlName = `temp_dossier_${config.persona}_${config.variant || 'base'}_${config.room_type}_${config.room_size}.html`;
    const tempHtmlPath = path.join(__dirname, tempHtmlName);
    fs.writeFileSync(tempHtmlPath, dossierHtml, 'utf8');
    console.log('✓ Successfully interpolated dynamic variables into template.');

    // L. PUPPETEER PDF GENERATION
    console.log('Starting Headless Puppeteer print pipeline...');
    const chromeExecutablePath = getChromeExecutablePath();
    if (!chromeExecutablePath) {
        throw new Error('Chrome executable not found. Set CHROME_PATH or install Google Chrome.');
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: chromeExecutablePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        const localUrl = 'file:///' + tempHtmlPath.replace(/\\/g, '/');
        await page.goto(localUrl, { waitUntil: 'networkidle0' });

        // Export borderless 10-page A4 PDF
        const outputPdfName = config.output_file
            ? path.basename(config.output_file)
            : `${config.persona}_${suffix}_${config.room_type}_${config.room_size}_${config.occupancy}_${config.pain}.pdf`;
        const outputPdfPath = config.output_file ? path.resolve(config.output_file) : path.join(OUTPUT_DIR, outputPdfName);
        fs.mkdirSync(path.dirname(outputPdfPath), { recursive: true });

        await page.pdf({
            path: outputPdfPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
        });

        console.log(`✓ Print successful! Saved dossier PDF to: "${outputPdfPath}"`);
    } finally {
        // Always close the browser and remove the temp HTML, even if PDF generation threw,
        // so a failed run doesn't leak an orphaned Chrome process or a stray temp_dossier_*.html file.
        if (browser) {
            await browser.close().catch(() => {});
        }
        if (fs.existsSync(tempHtmlPath)) {
            fs.unlinkSync(tempHtmlPath);
        }
    }

    console.log('\nDYNAMIC DOSSIER GENERATION COMPLETE!');
}

compileDossier().catch(console.error);
