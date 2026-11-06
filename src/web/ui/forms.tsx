import { useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Upload } from "lucide-react";

type FieldBits = { label: string; hint?: string; error?: string | null; className?: string };

function Field({ id, label, hint, error, className, children }: FieldBits & { id: string; children: ReactNode }) {
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string | null) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function Input({ label, hint, error, className, ...props }: FieldBits & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <input id={id} className="control" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...props} />
    </Field>
  );
}

export function DateInput(props: FieldBits & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <Input type="date" {...props} />;
}

export function Select({
  label,
  hint,
  error,
  className,
  options,
  ...props
}: FieldBits & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <select id={id} className="control" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Textarea({ label, hint, error, className, ...props }: FieldBits & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <textarea id={id} className="control" rows={4} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...props} />
    </Field>
  );
}

export function Checkbox({ label, ...props }: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className="check">
      <input type="checkbox" {...props} />
      {label}
    </label>
  );
}

export function FileDrop({
  label,
  hint = "PDF, photo or Word file, up to 50 MB",
  accept,
  onFiles,
}: {
  label: string;
  hint?: string;
  accept?: string;
  onFiles: (files: File[]) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`file-drop${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <Upload size={22} aria-hidden="true" />
      <label htmlFor={id}>
        <strong>{label}</strong>
        <br />
        <span>Drag a file here, or choose one</span>
      </label>
      <span className="field-hint">{hint}</span>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        className="visually-hidden"
        onChange={(e) => onFiles([...(e.target.files ?? [])])}
      />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>
        Choose a file
      </button>
    </div>
  );
}
