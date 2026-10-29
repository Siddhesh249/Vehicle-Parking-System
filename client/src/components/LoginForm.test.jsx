import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginForm from "./LoginForm.jsx";

async function fill(user, username, password) {
  await user.type(screen.getByLabelText(/username/i), username);
  await user.type(screen.getByLabelText(/password/i), password);
  await user.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginForm (VPS-F-001..005)", () => {
  test("masks the password and signs in with the entered credentials", async () => {
    const user = userEvent.setup();
    const api = { login: jest.fn().mockResolvedValue({ token: "jwt", role: "operator", gateId: "Exit-1" }) };
    const onSuccess = jest.fn();
    render(<LoginForm api={api} onSuccess={onSuccess} />);

    expect(screen.getByLabelText(/password/i)).toHaveAttribute("type", "password");
    await fill(user, " exit1 ", "s3cret");

    expect(api.login).toHaveBeenCalledWith({ username: "exit1", password: "s3cret" });
    expect(onSuccess).toHaveBeenCalledWith({ token: "jwt", role: "operator", gateId: "Exit-1" });
  });

  test("shows an invalid-credentials error and clears the password", async () => {
    const user = userEvent.setup();
    const api = { login: jest.fn().mockRejectedValue({ status: 401, message: "Invalid credentials" }) };
    const onSuccess = jest.fn();
    render(<LoginForm api={api} onSuccess={onSuccess} />);
    await fill(user, "exit1", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid credentials/i);
    expect(screen.getByLabelText(/password/i)).toHaveValue("");
    expect(screen.getByLabelText(/username/i)).toHaveValue("exit1");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("shows the locked-account message", async () => {
    const user = userEvent.setup();
    const api = { login: jest.fn().mockRejectedValue({ status: 423, message: "Account locked. Try again later." }) };
    render(<LoginForm api={api} onSuccess={jest.fn()} />);
    await fill(user, "exit1", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent(/account locked/i);
  });

  test("asks for both fields before calling the API", async () => {
    const user = userEvent.setup();
    const api = { login: jest.fn() };
    render(<LoginForm api={api} onSuccess={jest.fn()} />);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/enter your username and password/i);
    expect(api.login).not.toHaveBeenCalled();
  });
});
