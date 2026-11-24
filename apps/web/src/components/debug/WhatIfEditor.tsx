"use client";

import { useEffect, useId, useState } from "react";
import type { DecodedScValArgument, DiagnosticReport } from "@/lib/types";
import { parseScValJson } from "@/lib/wasm";

export type WhatIfField = DecodedScValArgument;

const NO_FIELDS: WhatIfField[] = [];

interface WhatIfEditorProps {
  fields?: WhatIfField[];
  report?: DiagnosticReport | null;
  onResimulate: (values: Record<string, string>) => void | Promise<void>;
}

function getInitialValues(fields: WhatIfField[]) {
  return Object.fromEntries(fields.map((field) => [field.name, field.value ?? ""]));
}

export default function WhatIfEditor({
  fields: providedFields,
  report,
  onResimulate,
}: WhatIfEditorProps) {
  const fields = providedFields ?? report?.transaction_context?.decoded_arguments ?? NO_FIELDS;
  const id = useId();
  const [values, setValues] = useState(() => getInitialValues(fields));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setValues((current) => ({
      ...getInitialValues(fields),
      ...Object.fromEntries(
        fields
          .filter((field) => current[field.name] !== undefined)
          .map((field) => [field.name, current[field.name]]),
      ),
    }));
  }, [fields]);

  const argumentsWithValidation = fields.map((field) => {
    try {
      const scVal = parseScValJson(values[field.name] ?? "", field.type);
      return { field, scVal, error: null };
    } catch (error) {
      return {
        field,
        scVal: null,
        error: error instanceof Error ? error.message : "Unable to parse argument.",
      };
    }
  });
  const isValid = fields.length > 0 && argumentsWithValidation.every(({ error }) => !error);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onResimulate(Object.fromEntries(fields.map(({ name }) => [name, values[name]])));
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Re-simulation failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-slate-900">What-if inputs</h2>
      {fields.length === 0 ? (
        <p className="text-sm text-slate-600">No editable inputs are available.</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {argumentsWithValidation.map(({ field, scVal, error }, index) => {
            const inputId = `${id}-argument-${index}`;
            const errorId = `${inputId}-error`;

            return (
              <div key={field.name}>
                <label
                  htmlFor={inputId}
                  className="mb-1 block text-sm font-medium text-slate-800"
                >
                  {field.label ?? field.name}
                  <span className="ml-2 font-mono text-xs text-slate-500">
                    {field.type}
                  </span>
                </label>
                <textarea
                  id={inputId}
                  rows={field.type === "vec" || field.type === "map" ? 4 : 1}
                  spellCheck={false}
                  value={values[field.name] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  className={`w-full rounded-md border px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 ${
                    error
                      ? "border-red-400 focus:ring-red-200"
                      : "border-slate-300 focus:ring-indigo-200"
                  }`}
                />
                {scVal && (
                  <details open className="mt-2 text-xs text-slate-600">
                    <summary className="cursor-pointer">ScVal preview</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-100 p-2">{JSON.stringify(scVal, null, 2)}</pre>
                  </details>
                )}
                {error && (
                  <p id={errorId} className="mt-1 text-sm text-red-700" role="alert">
                    {error}
                  </p>
                )}
              </div>
            );
          })}

          {submitError && (
            <p className="text-sm text-red-700" role="alert">
              {submitError}
            </p>
          )}
          <button
            type="submit"
            disabled={!isValid || submitting}
            className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Re-simulating..." : "Re-simulate"}
          </button>
        </form>
      )}
    </section>
  );
}
