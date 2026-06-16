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

interface Settings {
  defaultProvider: ProviderCode | null;
  defaultModels: Partial<Record<ProviderCode, string>>;
}

const emptySettings: Settings = {
  defaultProvider: null,
  defaultModels: {},
};

function SettingsPage() {
  const [settings, setSettings] = createSignal<Settings>(emptySettings);
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = createSignal<ProviderCode | "">("");
  const [draftDefaultModels, setDraftDefaultModels] = createSignal<
    Partial<Record<ProviderCode, string>>
  >({});
  const [editingProvider, setEditingProvider] = createSignal<Provider | null>(null);
  const [editingModel, setEditingModel] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [savedMessage, setSavedMessage] = createSignal("");

  const selectedProviderInfo = createMemo(() =>
    providers().find((provider) => provider.code === selectedProvider()),
  );
  const savedProviderInfo = createMemo(() =>
    providers().find((provider) => provider.code === settings().defaultProvider),
  );
  const savedProviderUnavailable = createMemo(
    () => Boolean(settings().defaultProvider) && savedProviderInfo()?.available === false,
  );
  const canSave = createMemo(() => Boolean(selectedProviderInfo()?.available) && !saving());

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
      setProviders(Array.isArray(nextProviders) ? nextProviders : []);
      setSelectedProvider(normalizedSettings.defaultProvider || "");
      setDraftDefaultModels({ ...normalizedSettings.defaultModels });
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
        input: {
          defaultProvider: provider.code,
          defaultModels: { ...draftDefaultModels() },
        },
      });
      const normalizedSettings = normalizeSettings(nextSettings);
      setSettings(normalizedSettings);
      setSelectedProvider(normalizedSettings.defaultProvider || "");
      setDraftDefaultModels({ ...normalizedSettings.defaultModels });
      setSavedMessage("Settings saved.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  function openEditor(provider: Provider): void {
    if (!provider.available || loading() || saving()) return;
    setEditingProvider(provider);
    setEditingModel(draftDefaultModels()[provider.code] ?? "");
  }

  function closeEditor(): void {
    setEditingProvider(null);
    setEditingModel("");
  }

  function applyEditor(event: Event): void {
    event.preventDefault();
    const provider = editingProvider();
    if (!provider) return;

    const trimmedModel = editingModel().trim();
    setDraftDefaultModels((current) => {
      const next = { ...current };
      if (trimmedModel) {
        next[provider.code] = trimmedModel;
      } else {
        delete next[provider.code];
      }
      return next;
    });
    closeEditor();
  }

  function providerDefaultModel(provider: Provider): string {
    return draftDefaultModels()[provider.code] || "auto";
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
                    "is-selected": selectedProvider() === provider.code,
                  }}
                >
                  <label class="provider-radio">
                    <input
                      type="radio"
                      name="defaultProvider"
                      value={provider.code}
                      checked={selectedProvider() === provider.code}
                      disabled={!provider.available}
                      onChange={() => setSelectedProvider(provider.code)}
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
                    aria-label={`Edit ${provider.name} default model`}
                    disabled={!provider.available || loading() || saving()}
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
              <footer class="settings-modal-actions">
                <button type="button" class="settings-secondary-button" onClick={closeEditor}>
                  Cancel
                </button>
                <button type="submit" class="settings-primary-button">
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
  };
}
