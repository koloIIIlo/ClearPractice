import { Link, useParams } from "react-router";
import { EmptyState, Page, PageHeader, Panel, QueryView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useExercises } from "@/lib/ipc/queries";

export function ExerciseDetailPage() {
  const { exerciseId } = useParams();
  const exercises = useExercises();

  return (
    <Page className="max-w-3xl">
      <QueryView query={exercises}>
        {(list) => {
          const ex = list.find((e) => e.id === exerciseId);
          if (!ex)
            return (
              <EmptyState title="This exercise isn't available" action={<Link to="/exercises">All exercises</Link>}>
                It may belong to a curriculum version that isn't installed.
              </EmptyState>
            );
          return (
            <>
              <PageHeader
                title={ex.title}
                description={ex.purpose}
                meta={`About ${ex.typicalMinutes} minutes · version ${ex.version}`}
                actions={
                  <Button size="lg" asChild>
                    <Link to={`/practice/${ex.id}`} state={{ section: "exercises" }}>
                      Start
                    </Link>
                  </Button>
                }
              />
              <Panel>
                <h2 className="mb-3 font-semibold">How it works</h2>
                <ol className="list-decimal space-y-2 pl-5">
                  {ex.instructions.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <h2 className="mt-6 mb-1 font-semibold">Pay attention to</h2>
                <p>{ex.attention}</p>
              </Panel>
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}
