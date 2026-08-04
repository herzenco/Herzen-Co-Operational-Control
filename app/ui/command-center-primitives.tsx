import type {
  ChangeEventHandler,
  HTMLAttributes,
  ReactNode,
} from "react";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function LiveLabel({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={classes("liveLabel", className)} {...props}>
      <i />
      {children}
    </span>
  );
}

type AgentMarkProps = HTMLAttributes<HTMLSpanElement> & {
  large?: boolean;
};

export function AgentMark({
  children,
  className,
  large = false,
  ...props
}: AgentMarkProps) {
  return (
    <span className={classes("agentMark", large && "large", className)} {...props}>
      {children}
    </span>
  );
}

type PanelHeaderProps = {
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
  eyebrowClassName?: string;
};

export function PanelHeader({
  eyebrow,
  title,
  meta,
  action,
  className,
  eyebrowClassName,
}: PanelHeaderProps) {
  return (
    <header className={classes("panelHead", className)}>
      <div>
        <span className={eyebrowClassName}>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {action ?? (meta !== undefined ? <small>{meta}</small> : null)}
    </header>
  );
}

export type MetricDeckItem = {
  label: ReactNode;
  value: ReactNode;
  note: ReactNode;
};

export function MetricDeck({
  items,
  className,
}: {
  items: MetricDeckItem[];
  className?: string;
}) {
  return (
    <section className={classes("metricDeck", className)}>
      {items.map((item, index) => (
        <div key={index}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.note}</small>
        </div>
      ))}
    </section>
  );
}

export function StatusPill({
  status,
  children,
  className,
}: {
  status: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={classes("statusPill", `s${status.replaceAll("_", "")}`, className)}>
      <i />
      {children}
    </span>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
}) {
  return (
    <label className="deckSearch">
      <span>/</span>
      <input value={value} onChange={onChange} placeholder={placeholder} />
    </label>
  );
}
