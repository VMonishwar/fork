import { createFileRoute } from "@tanstack/react-router";
import { ForkApp } from "@/components/fork/ForkApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fork — branching AI chat" },
      { name: "description", content: "A branching AI chat. Fork any message into a new branch without losing the original." },
      { property: "og:title", content: "Fork — branching AI chat" },
      { property: "og:description", content: "Branch from any message and explore different replies, all stored in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ForkApp,
});
