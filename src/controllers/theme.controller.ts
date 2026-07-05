import type { Request, Response } from "express";
import { createTheme, deleteTheme, updateTheme } from "../services/theme.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const createThemeHandler = asyncHandler(async (req: Request, res: Response) => {
  const theme = await createTheme(req.body);
  res.status(201).json(theme);
});

export const updateThemeHandler = asyncHandler(async (req: Request, res: Response) => {
  const { themeId } = req.params;
  const theme = await updateTheme(themeId , req.body);
  res.json(theme);
});

export const deleteThemeHandler = asyncHandler(async (req: Request, res: Response) => {
  const { themeId } = req.params;
  await deleteTheme(themeId);
  res.status(204).send();
});


import { getAllThemes } from "../services/theme.service.js";

export const getAllThemesHandler = asyncHandler(async (req: Request, res: Response) => {
  const themes = await getAllThemes();
  res.json(themes);
});
