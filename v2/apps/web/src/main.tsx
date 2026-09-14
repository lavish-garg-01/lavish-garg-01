import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";
const AdminDashboard=lazy(()=>import("./AdminDashboard.js").then(module=>({default:module.AdminDashboard})));

function Root() {
  const [admin,setAdmin]=useState(()=>location.hash==="#admin"||location.pathname==="/admin");
  useEffect(()=>{const update=()=>setAdmin(location.hash==="#admin"||(location.pathname==="/admin"&&!location.hash));window.addEventListener("hashchange",update);return()=>window.removeEventListener("hashchange",update);},[]);
  return admin?<Suspense fallback={<p role="status">Opening admin workspace…</p>}><AdminDashboard/></Suspense>:<App/>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
