import { render, screen } from "@testing-library/react";
import App from "./App.jsx";

describe("App", () => {
  test("renders the starter page heading", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /get started/i })
    ).toBeInTheDocument();
  });
});
