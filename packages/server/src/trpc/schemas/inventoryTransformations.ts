/** Zod contracts for saved inventory recipes and immutable executions. */

import { z } from 'zod';
import {
  inventoryTransformationKindEnum,
  inventoryTransformationOutputRoleEnum,
} from '../../db/schema.js';
import { isoDateField, paginationInput } from './common.js';

const positiveQuantity = z.number().finite().positive();
const isoDate = isoDateField();

const recipeInputLine = z.object({
  productId: z.string().min(1),
  baseQuantity: positiveQuantity,
});

const recipeOutputLine = z.object({
  productId: z.string().min(1),
  expectedBaseQuantity: positiveQuantity,
  allocationWeight: positiveQuantity,
  role: z.enum(inventoryTransformationOutputRoleEnum),
});

const recipeBody = z
  .object({
    siteId: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(inventoryTransformationKindEnum),
    notes: z.string().trim().max(1_000).nullable().optional(),
    isActive: z.boolean().optional(),
    inputs: z.array(recipeInputLine).min(1).max(50),
    outputs: z.array(recipeOutputLine).min(1).max(50),
  })
  .superRefine((value, ctx) => {
    const duplicateInput = value.inputs.find(
      (line, index) => value.inputs.findIndex(item => item.productId === line.productId) !== index
    );
    if (duplicateInput) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs'],
        message: 'Recipe inputs cannot repeat a product',
      });
    }
    const duplicateOutput = value.outputs.find(
      (line, index) => value.outputs.findIndex(item => item.productId === line.productId) !== index
    );
    if (duplicateOutput) {
      ctx.addIssue({
        code: 'custom',
        path: ['outputs'],
        message: 'Recipe outputs cannot repeat a product',
      });
    }
  });

export const createTransformationRecipeInput = recipeBody;
export const updateTransformationRecipeInput = recipeBody.extend({
  id: z.string().min(1),
  version: z.number().int().nonnegative(),
});

export const listTransformationRecipesInput = z
  .object({
    siteId: z.string().min(1).optional(),
    activeOnly: z.boolean().default(true),
    limit: z.number().int().positive().max(200).default(200),
    q: z.string().trim().max(120).optional(),
  })
  .optional();

export const getTransformationRecipeInput = z.object({ id: z.string().min(1) });

const executionInputLine = z.object({
  recipeInputId: z.string().min(1),
  baseQuantity: positiveQuantity,
  lotAllocations: z
    .array(
      z.object({
        lotId: z.string().min(1),
        baseQuantity: positiveQuantity,
      })
    )
    .min(1)
    .max(100)
    .optional(),
});

const executionOutputLine = z.object({
  recipeOutputId: z.string().min(1),
  baseQuantity: positiveQuantity,
  allocationWeight: positiveQuantity.optional(),
  lot: z
    .object({
      lotNumber: z.string().trim().min(1).max(120),
      expiresAt: isoDate.nullable().optional(),
      notes: z.string().trim().max(500).nullable().optional(),
    })
    .optional(),
});

export const executeInventoryTransformationInput = z.object({
  recipeId: z.string().min(1),
  siteId: z.string().min(1),
  notes: z.string().trim().max(1_000).nullable().optional(),
  inputs: z.array(executionInputLine).min(1).max(50),
  outputs: z.array(executionOutputLine).min(1).max(50),
  waste: z
    .array(
      z.object({
        recipeInputId: z.string().min(1),
        lotId: z.string().min(1).optional(),
        baseQuantity: positiveQuantity,
        reason: z.string().trim().min(1).max(500),
      })
    )
    .max(100)
    .default([]),
});

export const listInventoryTransformationsInput = paginationInput.extend({
  siteId: z.string().min(1).optional(),
  recipeId: z.string().min(1).optional(),
  status: z.enum(['completed', 'voided']).optional(),
});

export const getInventoryTransformationInput = z.object({ id: z.string().min(1) });

export const voidInventoryTransformationInput = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

export type CreateTransformationRecipeInput = z.infer<typeof createTransformationRecipeInput>;
export type UpdateTransformationRecipeInput = z.infer<typeof updateTransformationRecipeInput>;
export type ExecuteInventoryTransformationInput = z.infer<
  typeof executeInventoryTransformationInput
>;
export type ListInventoryTransformationsInput = z.infer<typeof listInventoryTransformationsInput>;
