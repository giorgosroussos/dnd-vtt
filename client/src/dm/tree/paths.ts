import { API_STRUCTURE_PATHS as PATHS } from '@emberglass/shared';

// REST paths of the tree's entities (D-078).
export type TreeKind = 'campaign' | 'session' | 'scene';

const withId = (template: string, id: string): string => template.replace(':id', encodeURIComponent(id));

export const entityPath = (kind: TreeKind, id: string): string =>
  withId({ campaign: PATHS.campaign, session: PATHS.session, scene: PATHS.scene }[kind], id);

export const sessionsPath = (campaignId: string): string => withId(PATHS.sessions, campaignId);
export const sessionOrderPath = (campaignId: string): string => withId(PATHS.sessionOrder, campaignId);
export const scenesPath = (sessionId: string): string => withId(PATHS.scenes, sessionId);
export const sceneOrderPath = (sessionId: string): string => withId(PATHS.sceneOrder, sessionId);
