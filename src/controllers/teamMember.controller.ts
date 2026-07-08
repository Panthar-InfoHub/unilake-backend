import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createTeamMember, deleteTeamMember, getActiveTeamMembers, getAllTeamMembers, getTeamMemberUploadUrl, toggleTeamMemberStatus, updateTeamMember } from "../services/teamMember.service.js";

export const getTeamMemberUploadUrlHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await getTeamMemberUploadUrl(req.body);
    res.status(200).json(result);
  }
);


export const createTeamMemberHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const teamMember = await createTeamMember(req.body);
    res.status(201).json(teamMember);
  }
);


export const updateTeamMemberHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const teamMember = await updateTeamMember(id as string, req.body);
    res.json(teamMember);
  }
);

export const toggleTeamMemberStatusHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const teamMember = await toggleTeamMemberStatus(id as string);
    res.json(teamMember);
  }
);


export const deleteTeamMemberHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await deleteTeamMember(id as string);
    res.status(204).send();
  }
);

export const getAllTeamMembersHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const teamMembers = await getAllTeamMembers();
    res.json(teamMembers);
  }
);


export const getActiveTeamMembersHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const teamMembers = await getActiveTeamMembers();
    res.json(teamMembers);
  }
);