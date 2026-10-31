import { ConnectionSession, ConnectionSessionError } from './connection-session';
import { DaemonApiError, object } from './daemon-api';
import { hostProfileSchema, type HostProfile } from '../../shared/schemas/host-profile';
import { catalogTextSchema, catalogIntegerSchema, catalogNumberSchema, rootIdSchema, modelIdSchema, customModelIdSchema, pretrainedSchema } from '../../shared/schemas/catalog';
import type { Json } from './daemon-api';

export interface BrowseEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
}

export interface BrowsePage {
  readonly root: string;
  readonly path: string;
  readonly entries: readonly BrowseEntry[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface DataSelection {
  readonly path: string;
  readonly root: string;
  readonly relativePath: string;
  readonly daemonId: string;
  readonly kind: 'file' | 'directory';
}

export interface ModelDescription {
  readonly id: string;
  readonly displayName: string;
  readonly architectureFamily: string;
  readonly authorInstitution: string;
  readonly yearPublished: number;
  readonly paramsM: number;
  readonly sizeMb: number;
  readonly shortDescription: string;
  readonly description: string;
  readonly bestFor: string;
  readonly pros: readonly string[];
  readonly cons: readonly string[];
  readonly computeTier: string;
  readonly tags: readonly string[];
  readonly supportedDims: readonly number[];
  readonly category: string;
  readonly pretrained: boolean;
}

export interface ModelSelection {
  readonly model: string;
  readonly daemonId: string;
  readonly source?: 'custom';
  readonly runtimeVerified?: false;
}

type Selection = DataSelection | ModelSelection;

const scopes = new WeakMap<Selection, { session: ConnectionSession; revision: number }>();

const catalogues = new WeakMap<
  readonly ModelDescription[],
  { session: ConnectionSession; revision: number }
>();

const fail = (): never => {
  throw DaemonApiError.fromKey('response', 'invalidDaemonCatalogResponse');
};

function text(value: Json | undefined, max = 8192): value is string {
  return catalogTextSchema(max).safeParse(value).success;
}

function nonEmptyText(value: Json | undefined, max = 8192): value is string {
  return text(value, max) && value.trim().length > 0;
}

function rootId(value: Json | undefined): value is string {
  return rootIdSchema.safeParse(value).success;
}

export function relativePath(value: Json | undefined): value is string {
  return (
    text(value, 4096) &&
    new TextEncoder().encode(value).length <= 4096 &&
    (value === '' ||
      (value.split('/').length <= 128 &&
        value
          .split('/')
          .every((part) => part !== '' && part !== '.' && part !== '..' && !/[\\:]/.test(part))))
  );
}

function integer(value: Json | undefined, max: number): value is number {
  return catalogIntegerSchema(max).safeParse(value).success;
}

function finite(value: Json | undefined, max: number): value is number {
  return catalogNumberSchema(max).safeParse(value).success;
}

function textList(value: Json | undefined, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => nonEmptyText(item, maxLength)) &&
    new Set(value).size === value.length
  );
}

const architectureFamilies = new Set(['CNN', 'Hybrid', 'Transformer', 'SSM', 'Encoder-Decoder']);
const computeTiers = new Set(['Edge', 'Low', 'Medium', 'High']);

function absolutePath(value: Json | undefined): value is string {
  if (!text(value, 8192)) return false;
  let parts: string[];

  if (value.startsWith('/')) parts = value.slice(1).split('/');
  else if (/^[A-Za-z]:\\/.test(value)) parts = value.slice(3).split('\\');
  else if (value.startsWith('\\\\')) {
    parts = value.slice(2).split('\\');

    if (parts.length < 2) return false;
  } else return false;

  return parts.every(
    (part, index) => part !== '.' && part !== '..' && (part !== '' || index === parts.length - 1),
  );
}

/** Catalogues describe installed metadata; they never certify runtime capability. */
export class CatalogApi {
  constructor(readonly session: ConnectionSession) {}
  assertSelection(selection: Selection): void {
    const scope = scopes.get(selection);

    if (
      !scope ||
      scope.session !== this.session ||
      scope.revision !== this.session.snapshot().revision ||
      !this.session.api ||
      selection.daemonId !== this.session.api.daemonId
    )
      throw ConnectionSessionError.fromKey('stale', 'catalogSelectionStale');
  }
  #selection<T extends Selection>(selection: T): T {
    scopes.set(selection, { session: this.session, revision: this.session.snapshot().revision });
    Object.freeze(selection);

    return selection;
  }
  /**
   * Advisory: an older daemon, a slow probe or a malformed reply yields null and
   * never retires the connection, so request failures stay inside the work.
   */
  async host(signal?: AbortSignal): Promise<HostProfile | null> {
    const body = await this.session.perform(
      async (api, requestSignal) => {
        try {
          return await api.read(
            '/api/host',
            AbortSignal.any([requestSignal, AbortSignal.timeout(45_000)]),
          );
        } catch {
          return null;
        }
      },
      { signal, timeoutMs: 60_000 },
    );

    const parsed = hostProfileSchema.safeParse(body);

    return parsed.success ? Object.freeze(parsed.data) : null;
  }
  roots(signal?: AbortSignal): Promise<readonly string[]> {
    return this.session.perform(
      async (api, requestSignal) => {
        const body = await api.read('/api/browse', requestSignal);

        if (
          !object(body) ||
          Object.keys(body).length !== 1 ||
          !Array.isArray(body.roots) ||
          body.roots.length > 32
        )
          return fail();

        const roots = body.roots.map((item) => {
          if (!object(item) || Object.keys(item).length !== 1 || !rootId(item.id)) return fail();

          return item.id;
        });

        if (new Set(roots).size !== roots.length) return fail();

        return Object.freeze(roots);
      },
      { signal },
    );
  }
  browse(root: string, path = '', offset = 0, signal?: AbortSignal): Promise<BrowsePage> {
    if (!rootId(root) || !relativePath(path) || !integer(offset, 10000))
      return Promise.reject(ConnectionSessionError.fromKey('request', 'invalidBrowseLocation'));
    const limit = 100;

    return this.session.perform(
      async (api, requestSignal) => {
        const query = new URLSearchParams({
          root,
          path,
          offset: String(offset),
          limit: String(limit),
        });

        const body = await api.read(`/api/browse?${query}`, requestSignal);

        if (
          !object(body) ||
          Object.keys(body).length !== 6 ||
          body.root !== root ||
          body.path !== path ||
          body.offset !== offset ||
          body.limit !== limit ||
          !integer(body.total, 10000) ||
          !Array.isArray(body.entries) ||
          body.entries.length > limit ||
          body.entries.length !== Math.min(limit, Math.max(0, body.total - offset))
        )
          return fail();

        const entries = body.entries.map((item) => {
          if (
            !object(item) ||
            Object.keys(item).length !== 2 ||
            !text(item.name, 4096) ||
            item.name === '' ||
            item.name.includes('/') ||
            !relativePath(item.name) ||
            (item.kind !== 'file' && item.kind !== 'directory')
          )
            return fail();

          return Object.freeze({ name: item.name, kind: item.kind });
        });

        if (new Set(entries.map((item) => item.name)).size !== entries.length) return fail();

        return Object.freeze({
          root,
          path,
          offset,
          limit,
          total: body.total,
          entries: Object.freeze(entries),
        });
      },
      { signal },
    );
  }
  resolve(root: string, path: string, signal?: AbortSignal): Promise<DataSelection> {
    if (!rootId(root) || !relativePath(path))
      return Promise.reject(ConnectionSessionError.fromKey('request', 'invalidBrowseSelection'));

    return this.session.perform(
      async (api, requestSignal) => {
        const body = await api.mutate(
          '/api/browse/resolve',
          { root, path },
          { signal: requestSignal },
        );

        if (
          !object(body) ||
          Object.keys(body).length !== 4 ||
          body.root !== root ||
          body.relative_path !== path ||
          !absolutePath(body.path) ||
          (body.kind !== 'file' && body.kind !== 'directory') ||
          (path === '' && body.kind !== 'directory') ||
          !api.daemonId
        )
          return fail();

        return this.#selection({
          path: body.path,
          root,
          relativePath: path,
          kind: body.kind,
          daemonId: api.daemonId,
        });
      },
      { signal },
    );
  }
  /**
   * Maps an absolute host path (from an imported config) onto a configured browse
   * root. Null when no root contains it; the daemon still verifies the final path.
   */
  async locate(path: string, signal?: AbortSignal): Promise<DataSelection | null> {
    if (!absolutePath(path)) return null;
    const target = path.replaceAll('\\', '/');

    for (const root of await this.roots(signal)) {
      let base: DataSelection;

      try {
        base = await this.resolve(root, '', signal);
      } catch (error) {
        // One unreadable root must not hide a match under another.
        if (signal?.aborted) throw error;
        continue;
      }

      const prefix = base.path.replaceAll('\\', '/').replace(/\/?$/, '/');
      const relative = target.startsWith(prefix) ? target.slice(prefix.length) : '';

      if (!relative || !relativePath(relative)) continue;

      try {
        return await this.resolve(root, relative, signal);
      } catch (error) {
        if (signal?.aborted) throw error;

        return null;
      }
    }

    return null;
  }
  models(signal?: AbortSignal): Promise<readonly ModelDescription[]> {
    return this.session.perform(
      async (api, requestSignal) => {
        const body = await api.read('/api/models', requestSignal);

        if (
          !object(body) ||
          Object.keys(body).length !== 4 ||
          new TextEncoder().encode(JSON.stringify(body)).length > 256 * 1024 ||
          body.source !== 'bundled_metadata' ||
          body.runtime_verified !== false ||
          !object(body.categories) ||
          Object.keys(body.categories).length > 128 ||
          !Array.isArray(body.models) ||
          body.models.length > 1000
        )
          return fail();
        const categories = new Map<string, string>();

        for (const [name, category] of Object.entries(body.categories)) {
          if (
            !text(name, 256) ||
            !object(category) ||
            !text(category.short_description) ||
            !Array.isArray(category.models) ||
            category.models.length > 1000
          )
            return fail();

          for (const id of category.models) {
            if (!text(id, 128) || !modelIdSchema.safeParse(id).success || categories.has(id))
              return fail();
            categories.set(id, name);
          }
        }

        const models = body.models.map((item) => {
          if (
            !object(item) ||
            Object.keys(item).length !== 16 ||
            !text(item.id, 128) ||
            !modelIdSchema.safeParse(item.id).success ||
            !nonEmptyText(item.display_name, 256) ||
            !nonEmptyText(item.architecture_family, 256) ||
            !architectureFamilies.has(item.architecture_family) ||
            !nonEmptyText(item.author_institution, 256) ||
            !integer(item.year_published, 3000) ||
            item.year_published < 1800 ||
            !finite(item.params_m, 1_000_000) ||
            !finite(item.size_mb, 1_000_000) ||
            !nonEmptyText(item.short_description, 8192) ||
            !nonEmptyText(item.description) ||
            !nonEmptyText(item.best_for) ||
            !textList(item.pros, 32, 2048) ||
            !textList(item.cons, 32, 2048) ||
            !nonEmptyText(item.compute_tier, 64) ||
            !computeTiers.has(item.compute_tier) ||
            !textList(item.tags, 32, 256) ||
            !pretrainedSchema.safeParse(item.is_pretrained).success ||
            !Array.isArray(item.supported_dims) ||
            item.supported_dims.length < 1 ||
            item.supported_dims.length > 3 ||
            !item.supported_dims.every((dim) => dim === 1 || dim === 2 || dim === 3) ||
            new Set(item.supported_dims).size !== item.supported_dims.length ||
            !categories.has(item.id)
          )
            return fail();

          return Object.freeze({
            id: item.id,
            displayName: item.display_name,
            architectureFamily: item.architecture_family,
            authorInstitution: item.author_institution,
            yearPublished: item.year_published,
            paramsM: item.params_m,
            sizeMb: item.size_mb,
            shortDescription: item.short_description,
            description: item.description,
            bestFor: item.best_for,
            pros: Object.freeze([...item.pros]),
            cons: Object.freeze([...item.cons]),
            computeTier: item.compute_tier,
            tags: Object.freeze([...item.tags]),
            supportedDims: Object.freeze([...item.supported_dims]),
            category: categories.get(item.id) ?? '',
            pretrained: pretrainedSchema.parse(item.is_pretrained),
          });
        });

        if (new Set(models.map((item) => item.id)).size !== models.length) return fail();
        const catalogue = Object.freeze(models);
        catalogues.set(catalogue, {
          session: this.session,
          revision: this.session.snapshot().revision,
        });

        return catalogue;
      },
      { signal },
    );
  }
  selectModel(model: ModelDescription, catalogue: readonly ModelDescription[]): ModelSelection {
    const daemonId = this.session.api?.daemonId;
    const scope = catalogues.get(catalogue);

    if (
      !daemonId ||
      !scope ||
      scope.session !== this.session ||
      scope.revision !== this.session.snapshot().revision ||
      !catalogue.includes(model)
    )
      throw ConnectionSessionError.fromKey('stale', 'modelCatalogReloadRequired');

    return this.#selection({ model: model.id, daemonId });
  }
  /** Explicit registry identifier only: required imports belong to the run request. */
  selectCustomModel(modelId: string, signal?: AbortSignal): Promise<ModelSelection> {
    if (!customModelIdSchema.safeParse(modelId).success)
      return Promise.reject(ConnectionSessionError.fromKey('request', 'modelIdInvalid'));

    return this.session.perform(
      async (api, requestSignal) => {
        const health = await api.health(requestSignal);

        return this.#selection({
          model: modelId,
          daemonId: health.daemon_id,
          source: 'custom',
          runtimeVerified: false,
        });
      },
      { signal },
    );
  }
}
