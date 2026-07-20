(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PLProductMatcher = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const ROOM_ANCHOR_ROLES = Object.freeze({
        living_room: 'Sofa (Anchor)',
        bedroom: 'Bed (Anchor)',
        kitchen: 'Dining Table',
        studio: 'Sleep Piece (Bed/Sofa-bed)',
        open_plan: 'Sofa (Anchor)',
        balcony: 'Lounge Seating',
        home_office: 'Desk (Anchor)'
    });

    const SIZE_KEYS = new Set(['micro', 'tight', 'compact', 'standard', 'generous', 'large']);

    function normalizeRoomType(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    }

    function normalizePersona(value) {
        const key = String(value || '').trim().toLowerCase();
        return ['sovereign', 'sage', 'alchemist', 'weaver'].find(persona => key.includes(persona)) || key;
    }

    function sizeKeyFromArea(area) {
        const numericArea = Number.parseFloat(String(area || '').replace(',', '.'));
        if (!Number.isFinite(numericArea)) return '';
        if (numericArea < 10) return 'micro';
        if (numericArea < 14) return 'tight';
        if (numericArea < 18) return 'compact';
        if (numericArea < 23) return 'standard';
        if (numericArea < 30) return 'generous';
        return 'large';
    }

    function normalizeSizeKey(value, area) {
        const key = String(value || '').trim().toLowerCase();
        if (SIZE_KEYS.has(key)) return key;
        return sizeKeyFromArea(area || value) || 'standard';
    }

    function findRealProductMatch(catalog, roomType, role, personaBase, sizeKey) {
        const room = normalizeRoomType(roomType);
        const persona = normalizePersona(personaBase);
        const size = normalizeSizeKey(sizeKey);
        const pool = (catalog && Array.isArray(catalog.furniture) ? catalog.furniture : [])
            .filter(item => item.role === role && (item.room_alignment || []).includes(room));
        if (pool.length === 0) return { product: null, matchQuality: 'none', sizeSafe: false };

        const fitsSize = item => !item.size_alignment || item.size_alignment.includes(size);
        const exact = pool.find(item => (item.persona_alignment || []).includes(persona) && fitsSize(item));
        if (exact) return { product: exact, matchQuality: 'persona_size', sizeSafe: true };

        const sizeMatch = pool.find(fitsSize);
        if (sizeMatch) return { product: sizeMatch, matchQuality: 'size', sizeSafe: true };

        const personaMatch = pool.find(item => (item.persona_alignment || []).includes(persona));
        if (personaMatch) return { product: personaMatch, matchQuality: 'persona_only', sizeSafe: false };
        return { product: pool[0], matchQuality: 'fallback', sizeSafe: false };
    }

    function findRealProduct(catalog, roomType, role, personaBase, sizeKey) {
        return findRealProductMatch(catalog, roomType, role, personaBase, sizeKey).product;
    }

    function getAnchorRole(roomType) {
        return ROOM_ANCHOR_ROLES[normalizeRoomType(roomType)] || '';
    }

    function findAnchorProduct(catalog, roomType, personaBase, sizeKey) {
        const role = getAnchorRole(roomType);
        if (!role) return null;
        const match = findRealProductMatch(catalog, roomType, role, personaBase, sizeKey);
        return match.sizeSafe ? match.product : null;
    }

    return {
        ROOM_ANCHOR_ROLES,
        normalizeRoomType,
        normalizePersona,
        normalizeSizeKey,
        sizeKeyFromArea,
        findRealProductMatch,
        findRealProduct,
        getAnchorRole,
        findAnchorProduct
    };
}));
