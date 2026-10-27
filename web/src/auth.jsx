// Who is signed in. The Login button is public; the server checks the
// session on every admin API call, so this only decides what the UI shows.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [me, setMe] = useState(undefined); // undefined = checking, null = signed out

  const refresh = useCallback(
    () =>
      api("/api/auth/me")
        .then((data) => setMe(data.authenticated ? data : null))
        .catch(() => setMe(null)),
    []
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (credentials) => {
      await api("/api/auth/login", { method: "POST", body: credentials, admin: true });
      await refresh();
    },
    [refresh]
  );

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", admin: true }).catch(() => {});
    setMe(null);
  }, []);

  return <AuthContext.Provider value={{ me, refresh, signIn, signOut, signedOut: () => setMe(null) }}>{children}</AuthContext.Provider>;
}
