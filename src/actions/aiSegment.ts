'use server';

import { GoogleGenAI } from '@google/genai';
import { config } from '@/lib/config';
import Logger from '@/lib/logger';
import { buildSegmentationPrompt } from '@/lib/prompts/segmentationPrompt';
import { DEFAULT_SEGMENTATION_OPTIONS, normalizeSegmentationOptions } from '@/lib/segmentation';
import type { SegmentationOptions, SegmentRange } from '@/lib/segmentation';
import type { TranscriptionWord } from './transcribe';

export interface AiSegmentationResult {
  ranges: SegmentRange[];
  model: string;
}

const AI_SEGMENTATION_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startIndex: { type: 'integer', description: 'Start word index (inclusive).' },
          endIndex: { type: 'integer', description: 'End word index (inclusive).' }
        },
        required: ['startIndex', 'endIndex'],
        additionalProperties: false
      },
      minItems: 1
    }
  },
  required: ['segments'],
  additionalProperties: false
};

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status?: number) => (status ? status === 429 || status >= 500 : false);

const parseRanges = (payload: any, totalWords: number): SegmentRange[] => {
  const segments = payload?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('AI segmentation response missing segments.');
  }

  const ranges = segments.map((item: any) => {
    const startIndex = Number(item?.startIndex);
    const endIndex = Number(item?.endIndex);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
      throw new Error('AI segmentation returned non-integer indices.');
    }
    if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
      throw new Error('AI segmentation returned invalid index range.');
    }
    return { startIndex, endIndex };
  });

  const sorted = [...ranges].sort((a, b) => a.startIndex - b.startIndex);
  if (sorted[0].startIndex !== 0) {
    throw new Error('AI segmentation must start from index 0.');
  }
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current.endIndex >= totalWords) {
      throw new Error('AI segmentation index out of bounds.');
    }
    if (i > 0) {
      const prev = sorted[i - 1];
      if (current.startIndex !== prev.endIndex + 1) {
        throw new Error('AI segmentation ranges must be contiguous.');
      }
    }
  }
  if (sorted[sorted.length - 1].endIndex !== totalWords - 1) {
    throw new Error('AI segmentation must cover all words.');
  }

  return sorted;
};

export async function aiSegmentWords(params: {
  words: TranscriptionWord[];
  options?: SegmentationOptions;
}): Promise<AiSegmentationResult | null> {
  const apiKey = config.uniApiKey;
  if (!apiKey) {
    return null;
  }

  const words = params.words || [];
  if (words.length === 0) {
    return null;
  }

  const model = config.geminiSegmentationModel || DEFAULT_MODEL;
  const options = normalizeSegmentationOptions(params.options ?? DEFAULT_SEGMENTATION_OPTIONS);
  const prompt = buildSegmentationPrompt({ words, options });
  const baseUrl = config.uniApiGeminiBaseUrl;

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      baseUrl
    }
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseJsonSchema: AI_SEGMENTATION_SCHEMA
        }
      });

      const text = response.text ?? response?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini response missing content.');
      }

      const parsed = JSON.parse(text);
      const ranges = parseRanges(parsed, words.length);
      return { ranges, model };
    } catch (error: any) {
      const status = typeof error?.status === 'number' ? error.status : undefined;
      if (attempt < MAX_ATTEMPTS && isRetryableStatus(status)) {
        Logger.warn(`Gemini segmentation retry ${attempt} due to error`, error);
        await sleep(200 * attempt);
        continue;
      }
      if (attempt < MAX_ATTEMPTS) {
        Logger.warn(`Gemini segmentation parse retry ${attempt}`, error);
        await sleep(200 * attempt);
        continue;
      }
      Logger.warn('Gemini segmentation failed after retries', error);
      return null;
    }
  }

  return null;
}
