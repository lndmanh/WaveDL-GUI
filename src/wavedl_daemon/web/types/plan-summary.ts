import type { ProjectBlock } from '../shared/schemas/project-draft';

export interface ReadinessItem {
  readonly block: ProjectBlock;
  readonly label: string;
  readonly detail: string;
  readonly done: boolean;
}

export interface PlanRow {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly changed: boolean;
}

export interface PlanSection {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly PlanRow[];
}

export type PlanCommand =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };
