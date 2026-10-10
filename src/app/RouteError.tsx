import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/page";

/** Global error boundary for routes. Saved practice data is never affected by a UI error. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <Page>
      <div role="alert" className="max-w-prose space-y-3">
        <h1 className="text-title font-semibold">{notFound ? "This page doesn't exist" : "Something went wrong"}</h1>
        <p className="text-muted-foreground">
          {notFound
            ? "The link may be out of date."
            : "This screen hit an unexpected error. Your recordings and notes are stored separately and are not affected."}
        </p>
        {!notFound && error instanceof Error && (
          <pre className="overflow-auto rounded-md bg-muted p-3 text-meta">{error.message}</pre>
        )}
        <Button asChild>
          <Link to="/">Go to Today</Link>
        </Button>
      </div>
    </Page>
  );
}
