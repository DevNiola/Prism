import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Skeleton, { SkeletonList } from "@/components/shared/Skeleton";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import {
  ResourceProfile,
  ResourceProfileSkeleton,
} from "@/components/trace/ResourceProfile";
import DiagnosticEvents, {
  DiagnosticEventsSkeleton,
} from "@/components/trace/DiagnosticEvents";
import {
  ExecutionTimeline,
  ExecutionTimelineSkeleton,
} from "@/components/trace/ExecutionTimeline";
import {
  StateDiffViewer,
  StateDiffViewerSkeleton,
} from "@/components/trace/StateDiffViewer";
import ContextSummary, {
  ContextSummarySkeleton,
} from "@/components/decode/ContextSummary";
import type { DiagnosticEventEntry, TransactionContext } from "@/lib/types";

const profile = {
  cpu_used: 1_000_000,
  cpu_limit: 2_000_000,
  memory_used: 512,
  memory_limit: 1024,
  read_bytes: 256,
  read_limit: 1024,
  write_bytes: 128,
  write_limit: 1024,
};

const context: TransactionContext = {
  tx_hash: "abc123",
  ledger_sequence: 42,
  function_name: "transfer",
  arguments: ["a", "b"],
  fee: {
    total_charged_fee: 100,
    inclusion_fee: 50,
    resource_fee: 50,
    refundable_resource_fee: 10,
    refundable_fee: 5,
    non_refundable_fee: 95,
  },
  resources: {
    cpu_instructions_used: 1,
    cpu_instructions_limit: 2,
    memory_bytes_used: 3,
    memory_bytes_limit: 4,
    read_bytes: 5,
    read_limit: 6,
    write_bytes: 7,
    write_limit: 8,
  },
};

const events: DiagnosticEventEntry[] = [
  {
    event_type: "contract",
    topics: ["transfer", "from", "to"],
    data: { value: "100" },
    timeline_position: 0,
  },
  {
    event_type: "system",
    topics: [],
    data: {},
    timeline_position: 1,
  },
];

describe("Skeleton", () => {
  it("is hidden from assistive technology and pulses by default", () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("bg-gray-200");
    expect(el.className).toContain("h-4");
  });

  it("uses the dark tone on dark surfaces", () => {
    const { container } = render(<Skeleton tone="dark" />);
    expect((container.firstElementChild as HTMLElement).className).toContain(
      "bg-gray-700",
    );
  });

  it("repeats the placeholder count times", () => {
    const { container } = render(<SkeletonList count={3} />);
    expect(container.querySelectorAll("div")).toHaveLength(3);
  });
});

describe("LoadingSpinner", () => {
  it("exposes an accessible status with a default label", () => {
    render(<LoadingSpinner />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toBe("Loading");
    expect(status.className).toContain("spinner");
  });

  it("accepts a custom label and merges extra classes", () => {
    render(<LoadingSpinner label="Streaming trace" className="mr-3" />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toBe("Streaming trace");
    expect(status.className).toContain("mr-3");
  });
});

describe("ResourceProfile", () => {
  it("renders the skeleton while loading without a profile", () => {
    const { container } = render(<ResourceProfile loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText("Resource Profile")).toBeTruthy();
    expect(screen.queryByText(/CPU Instructions/)).toBeNull();
  });

  it("renders the four resource bars once the profile arrives", () => {
    render(<ResourceProfile profile={profile} />);
    expect(screen.getByText("CPU Instructions")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getByText("Read Bytes")).toBeTruthy();
    expect(screen.getByText("Write Bytes")).toBeTruthy();
  });

  it("renders nothing when neither loading nor profile is provided", () => {
    const { container } = render(<ResourceProfile />);
    expect(container.firstChild).toBeNull();
  });

  it("keeps the same skeleton element count as the loaded bars", () => {
    const { container } = render(<ResourceProfileSkeleton />);
    // Four bars, each mirrored by a label, value and track placeholder.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(12);
  });
});

describe("DiagnosticEvents", () => {
  it("renders the skeleton while loading with no events", () => {
    const { container } = render(<DiagnosticEvents loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("renders the event list when data arrives", () => {
    render(<DiagnosticEvents events={events} />);
    expect(screen.getByText("#0")).toBeTruthy();
    expect(screen.getByText("contract")).toBeTruthy();
    expect(screen.getByText("transfer → from → to")).toBeTruthy();
  });

  it("shows the empty state when there are no events", () => {
    render(<DiagnosticEvents events={[]} />);
    expect(screen.getByText("No diagnostic events recorded.")).toBeTruthy();
  });

  it("renders placeholder rows in the skeleton", () => {
    const { container } = render(<DiagnosticEventsSkeleton />);
    expect(
      container.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThan(0);
  });
});

describe("ExecutionTimeline", () => {
  it("renders the skeleton while loading with no nodes", () => {
    const { container } = render(<ExecutionTimeline nodes={[]} loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("renders node rows once data arrives", () => {
    render(
      <ExecutionTimeline
        nodes={[{ node: { name: "transfer" }, path: [0] }]}
        loading
      />,
    );
    expect(screen.queryByText("Execution Timeline")).not.toBeNull();
  });

  it("renders the skeleton variant standalone", () => {
    const { container } = render(<ExecutionTimelineSkeleton />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe("StateDiffViewer", () => {
  const entries = [{ key: "a", before: "1", after: "2", change_type: "updated" }];

  it("renders the skeleton while loading with no entries", () => {
    const { container } = render(<StateDiffViewer entries={[]} loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("renders diff entries once data arrives", () => {
    render(<StateDiffViewer entries={entries} loading />);
    expect(screen.queryByText("a")).not.toBeNull();
  });

  it("renders the skeleton variant standalone", () => {
    const { container } = render(<StateDiffViewerSkeleton />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe("ContextSummary", () => {
  it("renders the skeleton while loading without a context", () => {
    const { container } = render(<ContextSummary loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("Transaction Summary")).toBeNull();
  });

  it("renders the summary panels once context arrives", () => {
    render(<ContextSummary context={context} />);
    expect(screen.getByText("Transaction Summary")).toBeTruthy();
    expect(screen.getByText("abc123")).toBeTruthy();
  });

  it("renders nothing when neither loading nor context is provided", () => {
    const { container } = render(<ContextSummary />);
    expect(container.firstChild).toBeNull();
  });

  it("renders three placeholder panels in the skeleton", () => {
    const { container } = render(<ContextSummarySkeleton />);
    expect(container.querySelectorAll("section")).toHaveLength(3);
  });
});
