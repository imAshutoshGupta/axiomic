/** The public site's 404 page. */
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Mark } from "@/components/ui/type";

export default function NotFound() {
  return (
    <div className="container">
      <PageHeader
        eyebrow="404"
        title={
          <>
            This page is <Mark padded>not here.</Mark>
          </>
        }
        lead="The address may be wrong, or the page may not be written yet."
      >
        <ButtonLink href="/">Go to the home page</ButtonLink>
      </PageHeader>
    </div>
  );
}
