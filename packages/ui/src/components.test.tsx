import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Nav,
  Select,
  Spinner,
  Table,
  Toast,
} from "./index.js";

afterEach(() => {
  cleanup();
});

describe("@cdp-us/ui components", () => {
  it("renders Button accessibly and handles clicks", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Create segment</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Create segment" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders Input with label, hint, error state, and change events", () => {
    const onChange = vi.fn();
    render(<Input error="Required" hint="Use a work email" label="Email" onChange={onChange} />);

    const input = screen.getByLabelText("Email");
    fireEvent.change(input, { target: { value: "ops@example.com" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Required")).toBeTruthy();
  });

  it("renders Select with options and label", () => {
    render(
      <Select
        label="Plan"
        options={[
          { label: "Starter", value: "starter" },
          { label: "Growth", value: "growth" },
        ]}
        placeholder="Select plan"
      />,
    );

    expect(screen.getByLabelText("Plan")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Growth" })).toBeTruthy();
  });

  it("renders Table headers and rows", () => {
    const rows = [
      { id: "one", status: "Live" },
      { id: "two", status: "Paused" },
    ] as const;

    render(
      <Table
        caption="Journeys"
        columns={[
          { header: "ID", key: "id", render: (row) => row.id },
          { header: "Status", key: "status", render: (row) => row.status },
        ]}
        getRowKey={(row) => row.id}
        rows={rows}
      />,
    );

    const table = screen.getByRole("table", { name: "Journeys" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("renders Card and Badge basics", () => {
    render(
      <Card aria-label="Usage card">
        <CardHeader>
          <CardTitle>Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="success">Healthy</Badge>
        </CardContent>
      </Card>,
    );

    expect(screen.getByRole("region", { name: "Usage card" })).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
  });

  it("renders Alert and Toast with live-region roles", () => {
    render(
      <>
        <Alert title="Sync delayed" variant="warning">
          Retry scheduled.
        </Alert>
        <Toast description="Audience export completed" title="Export ready" />
      </>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("status", { name: "" })).toBeTruthy();
    expect(screen.getByText("Audience export completed")).toBeTruthy();
  });

  it("renders EmptyState message", () => {
    render(<EmptyState message="No segments match this filter." title="No segments" />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("No segments match this filter.")).toBeTruthy();
  });

  it("renders Spinner with an accessible label", () => {
    render(<Spinner label="Loading profiles" />);

    expect(screen.getByRole("status", { name: "Loading profiles" })).toBeTruthy();
  });

  it("renders AppShell and Nav landmarks", () => {
    render(
      <AppShell
        brand="CDP-US"
        navItems={[
          { active: true, href: "/profiles", label: "Profiles" },
          { href: "/journeys", label: "Journeys" },
        ]}
      >
        <h1>Profiles</h1>
      </AppShell>,
    );

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByRole("navigation")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Profiles" })[0]?.getAttribute("aria-current")).toBe("page");
  });

  it("renders standalone Nav", () => {
    render(<Nav aria-label="Secondary" items={[{ href: "/settings", label: "Settings" }]} orientation="vertical" />);

    expect(screen.getByRole("navigation", { name: "Secondary" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
  });
});
