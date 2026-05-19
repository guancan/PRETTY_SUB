export type TranscriptTextToken = {
    word: string;
};

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CLOSING_PUNCTUATION_RE = /^[,.;:!?，。！？、；：）)\]}】》」』”’%％]/u;
const OPENING_PUNCTUATION_RE = /[（(\[{【《「『“‘]$/u;

const hasCjk = (text: string) => CJK_RE.test(text);
const isClosingPunctuation = (text: string) => CLOSING_PUNCTUATION_RE.test(text);
const endsWithOpeningPunctuation = (text: string) => OPENING_PUNCTUATION_RE.test(text);

export const isCjkText = (text: string): boolean => hasCjk(text);
export const isPunctuationText = (text: string): boolean => (
    CLOSING_PUNCTUATION_RE.test(text) || OPENING_PUNCTUATION_RE.test(text)
);

export function shouldInsertSpaceBetweenTokens(prev: string | undefined, next: string | undefined): boolean {
    if (!prev || !next) return false;

    const prevText = prev.trim();
    const nextText = next.trim();
    if (!prevText || !nextText) return false;

    if (isClosingPunctuation(nextText)) return false;
    if (endsWithOpeningPunctuation(prevText)) return false;

    if (hasCjk(prevText) || hasCjk(nextText)) return false;

    return true;
}

export function joinTranscriptTokens(tokens: TranscriptTextToken[]): string {
    return tokens.reduce((text, token) => {
        const next = token.word;
        if (!next) return text;
        if (!text) return next;
        return `${text}${shouldInsertSpaceBetweenTokens(text.at(-1), next) ? ' ' : ''}${next}`;
    }, '');
}

export function getTranscriptTextLength(tokens: TranscriptTextToken[]): number {
    return joinTranscriptTokens(tokens).length;
}
