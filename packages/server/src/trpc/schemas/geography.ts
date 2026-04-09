import { z } from 'zod';
import { paginationInput } from './common.js';

export const listDepartmentsInput = paginationInput.extend({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
  countryId: z.string().optional(),
});

export const listCountriesInput = paginationInput.extend({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const getCountryInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createCountryInput = z.object({
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(1, 'Name is required').max(255),
  isActive: z.boolean().default(true),
});

export const updateCountryInput = z.object({
  id: z.string().min(1, 'ID is required'),
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
});

export const deleteCountryInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchCountriesInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
  isActive: z.boolean().optional(),
});

export const getDepartmentInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createDepartmentInput = z.object({
  countryId: z.string().min(1, 'Country is required'),
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(1, 'Name is required').max(255),
  isActive: z.boolean().default(true),
});

export const updateDepartmentInput = z.object({
  id: z.string().min(1, 'ID is required'),
  countryId: z.string().min(1).optional(),
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
});

export const deleteDepartmentInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchDepartmentsInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
  isActive: z.boolean().optional(),
});

export const listCitiesInput = paginationInput.extend({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
  departmentId: z.string().optional(),
});

export const getCityInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createCityInput = z.object({
  departmentId: z.string().min(1, 'Department is required'),
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(1, 'Name is required').max(255),
  isActive: z.boolean().default(true),
});

export const updateCityInput = z.object({
  id: z.string().min(1, 'ID is required'),
  departmentId: z.string().min(1).optional(),
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
});

export const deleteCityInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchCitiesInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
  isActive: z.boolean().optional(),
  departmentId: z.string().optional(),
});
