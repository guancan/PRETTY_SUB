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
      description: 'Array of subtitle segments. Each segment defines a continuous range of word indices.',
      items: {
        type: 'object',
        properties: {
          startIndex: {
            type: 'integer',
            description: 'The starting word index of this segment (inclusive, 0-based). Must be 0 for the first segment.'
          },
          endIndex: {
            type: 'integer',
            description: 'The ending word index of this segment (inclusive). Must be the last word index for the final segment.'
          }
        },
        required: ['startIndex', 'endIndex']
      },
      minItems: 1
    }
  },
  required: ['segments']
} as const;

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status?: number) => (status ? status === 429 || status >= 500 : false);

const parseRanges = (payload: any, totalWords: number): SegmentRange[] => {
  if (config.debugAiSegmentation) {
    Logger.debug('[Parse Ranges] Input payload:', {
      payloadType: typeof payload,
      payloadKeys: payload ? Object.keys(payload) : 'null',
      payload: JSON.stringify(payload, null, 2),
      totalWords
    });
  }

  const segments = payload?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error(
      `AI segmentation response missing segments. Received payload: ${JSON.stringify(payload)}`
    );
  }

  const ranges = segments.map((item: any, index: number) => {
    const startIndex = Number(item?.startIndex);
    const endIndex = Number(item?.endIndex);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
      throw new Error(
        `AI segmentation returned non-integer indices at segment ${index}: ${JSON.stringify(item)}`
      );
    }
    if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
      throw new Error(
        `AI segmentation returned invalid index range at segment ${index}: startIndex=${startIndex}, endIndex=${endIndex}`
      );
    }
    return { startIndex, endIndex };
  });

  const sorted = [...ranges].sort((a, b) => a.startIndex - b.startIndex);
  if (sorted[0].startIndex !== 0) {
    throw new Error(
      `AI segmentation must start from index 0. First segment starts at ${sorted[0].startIndex}`
    );
  }
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current.endIndex >= totalWords) {
      throw new Error(
        `AI segmentation index out of bounds at segment ${i}: endIndex=${current.endIndex}, totalWords=${totalWords}`
      );
    }
    if (i > 0) {
      const prev = sorted[i - 1];
      if (current.startIndex !== prev.endIndex + 1) {
        throw new Error(
          `AI segmentation ranges must be contiguous. Gap detected: segment ${i - 1} ends at ${prev.endIndex}, segment ${i} starts at ${current.startIndex}`
        );
      }
    }
  }
  if (sorted[sorted.length - 1].endIndex !== totalWords - 1) {
    throw new Error(
      `AI segmentation must cover all words. Last segment ends at ${sorted[sorted.length - 1].endIndex}, expected ${totalWords - 1}`
    );
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
      if (config.debugAiSegmentation) {
        Logger.debug('[AI Segmentation Request]', {
          attempt,
          model,
          wordsCount: words.length,
          prompt: prompt.substring(0, 500) + '...',
          options
        });
      }

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: AI_SEGMENTATION_SCHEMA as any
        }
      });

      const text = response.text ?? response?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini response missing content.');
      }

      if (config.debugAiSegmentation) {
        Logger.debug('[AI Segmentation Raw Response]', {
          attempt,
          rawText: text,
          responseStructure: JSON.stringify(response, null, 2).substring(0, 1000) + '...'
        });
      }

      const parsed = JSON.parse(text);

      if (config.debugAiSegmentation) {
        Logger.debug('[AI Segmentation Parsed JSON]', {
          attempt,
          parsed,
          segmentsCount: parsed?.segments?.length || 0
        });
      }

      const ranges = parseRanges(parsed, words.length);

      if (config.debugAiSegmentation) {
        Logger.debug('[AI Segmentation Final Ranges]', {
          attempt,
          ranges,
          rangesCount: ranges.length
        });
      }

      return { ranges, model };
    } catch (error: any) {
      const status = typeof error?.status === 'number' ? error.status : undefined;

      if (config.debugAiSegmentation) {
        Logger.debug('[AI Segmentation Error]', {
          attempt,
          status,
          errorMessage: error?.message || 'Unknown error',
          errorStack: error?.stack
        });
      }

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
