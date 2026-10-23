"use client";

import { useEffect, useState } from "react";
import { validateScVal, type SorobanValueType } from "@/lib/wasm";

export interface WhatIfField {
  name: string;
  type: SorobanValueType;
  label?: string;
  value?: string;
}

interface WhatIfEditorProps {
  fields: WhatIfField[];
  onResimulate: (values: Record<string, string>) => void | Promise<void>;
}

function getInitialValues(fields: WhatIfField[]) {
  return Object.fromEntries(fields.map((field) => [field.name, field.value ?? ""]));
}

export default function WhatIfEditor({
  fields,
  onResimulate,
}: WhatIfEditorProps) {
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

  const errors = Object.fromEntries(
    fields.map((field) => [
      field.name,
      validateScVal(values[field.name] ?? "", field.type),
    ]),
  );
  const isValid = fields.length > 0 && Object.values(errors).every((error) => !error);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onResimulate(values);
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
          {fields.map((field) => {
            const error = errors[field.name];
            const inputId = `what-if-${field.name}`;
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
                <input
                  id={inputId}
                  type="text"
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
