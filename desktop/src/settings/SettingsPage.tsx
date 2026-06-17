import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

type ProviderCode = "codex" | "gemini" | "opencode" | "cursor" | "claude" | "ollama";

interface Provider {
  code: ProviderCode;
  name: string;
  available: boolean;
  error?: string | null;
  description?: string;
}

interface OllamaProviderSettings {
  baseUrl: string;
  timeoutMs: number;
}

interface ProviderSettings {
  ollama: OllamaProviderSettings;
}

interface Settings {
  defaultProvider: ProviderCode | null;
  defaultModels: Partial<Record<ProviderCode, string>>;
  providerSettings: ProviderSettings;
}

interface OllamaModelOption {
  value: string;
  label: string;
}

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_TIMEOUT_MS = 120000;

const emptySettings: Settings = {
  defaultProvider: null,
  defaultModels: {},
  providerSettings: {
    ollama: {
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      timeoutMs: DEFAULT_OLLAMA_TIMEOUT_MS,
    },
  },
};

function SettingsPage() {
  const [settings, setSettings] = createSignal<Settings>(emptySettings);
  const [draftSettings, setDraftSettings] = createSignal<Settings>(emptySettings);
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [editingProvider, setEditingProvider] = createSignal<Provider | null>(null);
  const [editingBaseUrl, setEditingBaseUrl] = createSignal("");
  const [editingTimeoutMs, setEditingTimeoutMs] = createSignal("");
  const [editingModel, setEditingModel] = createSignal("");
  const [ollamaModels, setOllamaModels] = createSignal<OllamaModelOption[]>([]);
  const [ollamaModelsLoading, setOllamaModelsLoading] = createSignal(false);
  const [ollamaModelsError, setOllamaModelsError] = createSignal("");
  const [fieldError, setFieldError] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [savedMessage, setSavedMessage] = createSignal("");
  let ollamaModelsRequestSeq = 0;

  const selectedProviderInfo = createMemo(() =>
    providers().find((provider) => provider.code === draftSettings().defaultProvider),
  );
  const savedProviderInfo = createMemo(() =>
    providers().find((provider) => provider.code === settings().defaultProvider),
  );
  const savedProviderUnavailable = createMemo(
    () => Boolean(settings().defaultProvider) && savedProviderInfo()?.available === false,
  );
  const canSave = createMemo(() => Boolean(selectedProviderInfo()?.available) && !saving());
  const canApplyOllama = createMemo(() => {
    if (ollamaModelsLoading() || ollamaModelsError() || fieldError()) return false;
    if (!editingModel()) return false;
    return ollamaModels().some((model) => model.value === editingModel());
  });

  onMount(() => {
    loadSettings();
  });

  createEffect(() => {
    if (!editingProvider()) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  async function loadSettings(): Promise<void> {
    setLoading(true);
    setError("");
    setSavedMessage("");
    closeEditor();
    try {
      const [nextSettings, nextProviders] = await Promise.all([
        invoke<Settings>("get_settings"),
        invoke<Provider[]>("list_providers"),
      ]);
      const normalizedSettings = normalizeSettings(nextSettings);
      setSettings(normalizedSettings);
      setDraftSettings(cloneSettings(normalizedSettings));
      setProviders(Array.isArray(nextProviders) ? nextProviders : []);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(event: Event): Promise<void> {
    event.preventDefault();
    setError("");
    setSavedMessage("");

    const provider = selectedProviderInfo();
    if (!provider?.available) {
      setError("Choose an available provider before saving.");
      return;
    }

    setSaving(true);
    try {
      const nextSettings = await invoke<Settings>("update_settings", {
        input: cloneSettings({
          ...draftSettings(),
          defaultProvider: provider.code,
        }),
      });
      const normalizedSettings = normalizeSettings(nextSettings);
      setSettings(normalizedSettings);
      setDraftSettings(cloneSettings(normalizedSettings));
      setSavedMessage("Settings saved.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  function setDraftProvider(provider: ProviderCode): void {
    setDraftSettings((current) => ({ ...current, defaultProvider: provider }));
  }

  function openEditor(provider: Provider): void {
    if (!canEditProvider(provider)) return;
    clearModalState();
    setEditingProvider(provider);
    setEditingModel(draftSettings().defaultModels[provider.code] ?? "");
    if (provider.code === "ollama") {
      const ollama = draftSettings().providerSettings.ollama;
      setEditingBaseUrl(ollama.baseUrl);
      setEditingTimeoutMs(String(ollama.timeoutMs));
      void loadOllamaModels(ollama.baseUrl, String(ollama.timeoutMs), draftSettings().defaultModels.ollama ?? "");
    }
  }

  function closeEditor(): void {
    ollamaModelsRequestSeq += 1;
    setEditingProvider(null);
    clearModalState();
  }

  function clearModalState(): void {
    setEditingBaseUrl("");
    setEditingTimeoutMs("");
    setEditingModel("");
    setOllamaModels([]);
    setOllamaModelsLoading(false);
    setOllamaModelsError("");
    setFieldError("");
  }

  function canEditProvider(provider: Provider): boolean {
    if (loading() || saving()) return false;
    return provider.available || provider.code === "ollama";
  }

  async function loadOllamaModels(
    baseUrlValue = editingBaseUrl(),
    timeoutValue = editingTimeoutMs(),
    currentModel = editingModel(),
  ): Promise<void> {
    const requestSeq = ++ollamaModelsRequestSeq;
    setFieldError("");
    setOllamaModelsError("");
    setOllamaModels([]);

    const timeout = parseOptionalTimeout(timeoutValue);
    if (!timeout.ok) {
      setFieldError(timeout.error);
      return;
    }

    setOllamaModelsLoading(true);
    try {
      const models = await invoke<OllamaModelOption[]>("list_ollama_models", {
        input: {
          baseUrl: baseUrlValue,
          timeoutMs: timeout.value,
        },
      });
      if (!isCurrentOllamaRequest(requestSeq)) return;

      const nextModels = Array.isArray(models) ? models : [];
      setOllamaModels(nextModels);
      if (currentModel && nextModels.some((model) => model.value === currentModel)) {
        setEditingModel(currentModel);
      } else {
        setEditingModel("");
      }
    } catch (err) {
      if (!isCurrentOllamaRequest(requestSeq)) return;
      setOllamaModels([]);
      setOllamaModelsError(formatError(err));
      setEditingModel("");
    } finally {
      if (isCurrentOllamaRequest(requestSeq)) {
        setOllamaModelsLoading(false);
      }
    }
  }

  function isCurrentOllamaRequest(requestSeq: number): boolean {
    return requestSeq === ollamaModelsRequestSeq && editingProvider()?.code === "ollama";
  }

  function applyEditor(event: Event): void {
    event.preventDefault();
    const provider = editingProvider();
    if (!provider) return;

    if (provider.code === "ollama") {
      applyOllamaEditor();
      return;
    }

    const trimmedModel = editingModel().trim();
    setDraftSettings((current) => {
      const next = cloneSettings(current);
      if (trimmedModel) {
        next.defaultModels[provider.code] = trimmedModel;
      } else {
        delete next.defaultModels[provider.code];
      }
      return next;
    });
    closeEditor();
  }

  function applyOllamaEditor(): void {
    setFieldError("");
    if (ollamaModelsLoading() || ollamaModelsError()) return;

    const baseUrl = normalizeBaseUrlInput(editingBaseUrl());
    if (!baseUrl.ok) {
      setFieldError(baseUrl.error);
      return;
    }
    const timeout = parseOptionalTimeout(editingTimeoutMs());
    if (!timeout.ok) {
      setFieldError(timeout.error);
      return;
    }
    const model = editingModel();
    if (!model || !ollamaModels().some((option) => option.value === model)) {
      setFieldError("Select an Ollama model from the latest model list.");
      return;
    }

    setDraftSettings((current) => {
      const next = cloneSettings(current);
      next.providerSettings.ollama = {
        baseUrl: baseUrl.value,
        timeoutMs: timeout.value ?? DEFAULT_OLLAMA_TIMEOUT_MS,
      };
      next.defaultModels.ollama = model;
      return next;
    });
    closeEditor();
  }

  function providerDefaultModel(provider: Provider): string {
    return draftSettings().defaultModels[provider.code] || "auto";
  }

  return (
    <main class="settings-page">
      <header class="settings-header">
        <div>
          <h1>Settings</h1>
          <p>Choose the default provider and optional model used by SDK sessions.</p>
        </div>
        <button type="button" class="settings-secondary-button" onClick={loadSettings} disabled={loading()}>
          Refresh
        </button>
      </header>

      <Show when={error()}>
        <div class="settings-alert is-error">{error()}</div>
      </Show>
      <Show when={savedMessage()}>
        <div class="settings-alert is-success">{savedMessage()}</div>
      </Show>
      <Show when={savedProviderUnavailable()}>
        <div class="settings-alert is-warning">
          Saved default provider "{settings().defaultProvider}" is currently unavailable. Choose an available provider before saving.
        </div>
      </Show>

      <form class="settings-panel" onSubmit={saveSettings}>
        <section class="settings-section">
          <div class="settings-section-heading">
            <h2>Default Provider</h2>
            <span>{loading() ? "Loading..." : `${providers().length} providers`}</span>
          </div>

          <div class="provider-list">
            <For each={providers()}>
              {(provider) => (
                <div
                  class="provider-option"
                  classList={{
                    "is-unavailable": !provider.available,
                    "is-selected": draftSettings().defaultProvider === provider.code,
                  }}
                >
                  <label class="provider-radio">
                    <input
                      type="radio"
                      name="defaultProvider"
                      value={provider.code}
                      checked={draftSettings().defaultProvider === provider.code}
                      disabled={!provider.available}
                      onChange={() => setDraftProvider(provider.code)}
                    />
                  </label>
                  <span class="provider-main">
                    <strong>{provider.name}</strong>
                    <span>{provider.code}</span>
                    <span>default model: {providerDefaultModel(provider)}</span>
                  </span>
                  <span class="provider-status" data-status={provider.available ? "available" : "unavailable"}>
                    {provider.available ? "Available" : "Unavailable"}
                  </span>
                  <button
                    type="button"
                    class="provider-edit-button"
                    aria-label={`Edit ${provider.name} settings`}
                    disabled={!canEditProvider(provider)}
                    onClick={() => openEditor(provider)}
                  >
                    Edit
                  </button>
                  <Show when={provider.error}>
                    <span class="provider-error">{provider.error}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </section>

        <footer class="settings-actions">
          <button type="submit" class="settings-primary-button" disabled={!canSave()}>
            {saving() ? "Saving..." : "Save"}
          </button>
        </footer>
      </form>

      <Show when={editingProvider()}>
        {(provider) => (
          <div class="settings-modal-backdrop" role="presentation">
            <form class="settings-modal" role="dialog" aria-modal="true" onSubmit={applyEditor}>
              <header class="settings-modal-header">
                <div>
                  <h2>{provider().name}</h2>
                  <p>Edit provider settings</p>
                </div>
              </header>

              <Show
                when={provider().code === "ollama"}
                fallback={
                  <label class="settings-field">
                    <span>
                      Default Model <em>Optional</em>
                    </span>
                    <input
                      type="text"
                      value={editingModel()}
                      onInput={(event) => setEditingModel(event.currentTarget.value)}
                      autofocus
                    />
                  </label>
                }
              >
                <div class="settings-modal-fields">
                  <label class="settings-field">
                    <span>
                      Base URL <em>Optional</em>
                    </span>
                    <input
                      type="text"
                      value={editingBaseUrl()}
                      placeholder={DEFAULT_OLLAMA_BASE_URL}
                      onInput={(event) => setEditingBaseUrl(event.currentTarget.value)}
                      onBlur={() => loadOllamaModels()}
                      autofocus
                    />
                  </label>
                  <label class="settings-field">
                    <span>
                      Timeout Milliseconds <em>Optional</em>
                    </span>
                    <input
                      type="text"
                      inputmode="numeric"
                      value={editingTimeoutMs()}
                      placeholder={String(DEFAULT_OLLAMA_TIMEOUT_MS)}
                      onInput={(event) => setEditingTimeoutMs(event.currentTarget.value)}
                    />
                  </label>
                  <label class="settings-field">
                    <span>
                      Default Model <em>Required</em>
                    </span>
                    <select
                      value={editingModel()}
                      disabled={ollamaModelsLoading() || Boolean(ollamaModelsError()) || ollamaModels().length === 0}
                      onChange={(event) => setEditingModel(event.currentTarget.value)}
                    >
                      <option value="">Select a model</option>
                      <For each={ollamaModels()}>
                        {(model) => <option value={model.value}>{model.label}</option>}
                      </For>
                    </select>
                  </label>
                  <div class="settings-modal-status" aria-live="polite">
                    <Show when={ollamaModelsLoading()}>
                      <span>Loading models...</span>
                    </Show>
                    <Show when={!ollamaModelsLoading() && !ollamaModelsError() && ollamaModels().length === 0}>
                      <span>No Ollama models available.</span>
                    </Show>
                    <Show when={ollamaModelsError()}>
                      <span class="settings-field-error">{ollamaModelsError()}</span>
                    </Show>
                    <Show when={fieldError()}>
                      <span class="settings-field-error">{fieldError()}</span>
                    </Show>
                  </div>
                </div>
              </Show>

              <footer class="settings-modal-actions">
                <button type="button" class="settings-secondary-button" onClick={closeEditor}>
                  Cancel
                </button>
                <button
                  type="submit"
                  class="settings-primary-button"
                  disabled={provider().code === "ollama" && !canApplyOllama()}
                >
                  Apply
                </button>
              </footer>
            </form>
          </div>
        )}
      </Show>
    </main>
  );
}

export default SettingsPage;

function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  const e = err as { code?: string; message?: string };
  if (e.code && e.message) return `${e.code}: ${e.message}`;
  return e.message || JSON.stringify(err);
}

function normalizeSettings(value: Settings | null | undefined): Settings {
  return {
    defaultProvider: value?.defaultProvider ?? null,
    defaultModels: { ...(value?.defaultModels ?? {}) },
    providerSettings: {
      ollama: {
        baseUrl: value?.providerSettings?.ollama?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL,
        timeoutMs: value?.providerSettings?.ollama?.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS,
      },
    },
  };
}

function cloneSettings(settings: Settings): Settings {
  return {
    defaultProvider: settings.defaultProvider,
    defaultModels: { ...settings.defaultModels },
    providerSettings: {
      ollama: { ...settings.providerSettings.ollama },
    },
  };
}

function normalizeBaseUrlInput(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: DEFAULT_OLLAMA_BASE_URL };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error: "Base URL must use http:// or https://." };
    }
    return { ok: true, value: trimmed.replace(/\/+$/, "") };
  } catch {
    return { ok: false, error: "Base URL must be a valid absolute URL." };
  }
}

function parseOptionalTimeout(value: string): { ok: true; value?: number } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: DEFAULT_OLLAMA_TIMEOUT_MS };
  if (!/^[0-9]+$/.test(trimmed)) {
    return { ok: false, error: "Timeout must be a positive integer." };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { ok: false, error: "Timeout must be a positive integer." };
  }
  return { ok: true, value: parsed };
}
