import {v2assert} from './errors.ts';

export type StyleColorKey = {style_code: string; color_code: string};
export type SkuKey = StyleColorKey & {size_system: string; size_code: string};

const PART = /^[^\s/\\\u0000-\u001f]{1,64}$/u;

function part(value: string, field: string, max = 64): string {
    const trimmed = value.trim();
    v2assert(PART.test(trimmed) && trimmed.length <= max, 'INVALID_STYLE_COLOR_KEY', `${field} 不合法`, {field});
    return trimmed;
}

export function parseStyleColorKey(input: string): StyleColorKey {
    const parts = typeof input === 'string' ? input.split('/') : [];
    v2assert(parts.length === 2, 'INVALID_STYLE_COLOR_KEY', '款色码须为 款号/色号');
    return {style_code: part(parts[0], 'style_code'), color_code: part(parts[1], 'color_code')};
}

/** The only SKU identity used by store-v2. Missing parts are rejected, never guessed from the style. */
export function parseSkuKey(input: string): SkuKey {
    const parts = typeof input === 'string' ? input.split('/') : [];
    v2assert(parts.length === 4, 'INVALID_STYLE_COLOR_KEY', '款色码须为 款号/色号/尺码体系/尺码');
    return {
        style_code: part(parts[0], 'style_code'),
        color_code: part(parts[1], 'color_code'),
        size_system: part(parts[2], 'size_system', 24),
        size_code: part(parts[3], 'size_code', 24),
    };
}

export function formatSkuKey(key: SkuKey): string {
    return [key.style_code, key.color_code, key.size_system, key.size_code].join('/');
}
