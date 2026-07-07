import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createAnnouncement, deleteAnnouncement, getActiveAnnouncements, listAnnouncements, reorderAnnouncements, toggleAnnouncementStatus, updateAnnouncement } from '../services/announcement.service.js';

export const createAnnouncementHandler = asyncHandler(async (req: Request, res: Response) => {
  const announcement = await createAnnouncement(req.body);
  res.status(201).json(announcement);
});


export const updateAnnouncementHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const announcement = await updateAnnouncement(id as string, req.body);
  res.status(200).json(announcement);
});


export const listAnnouncementsHandler = asyncHandler(async (req: Request, res: Response) => {
  const announcements = await listAnnouncements();
  res.status(200).json(announcements);
});

export const toggleAnnouncementStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const announcement = await toggleAnnouncementStatus(id as string);
  res.status(200).json(announcement);
}); 

export const reorderAnnouncementsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { orderedIds } = req.body;
  const announcements = await reorderAnnouncements(orderedIds);
  res.status(200).json(announcements);
});

export const deleteAnnouncementHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await deleteAnnouncement(id as string);
  res.status(204).send();
});

export const getActiveAnnouncementsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const announcements = await getActiveAnnouncements();
    res.json(announcements);
  }
);