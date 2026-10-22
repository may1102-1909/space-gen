import { redirect } from 'next/navigation';

// Client presentations are per project and per share link (/p/[shareToken]); create one from the editor's Share dialog.
export default function PresentRedirect() {
  redirect('/projects');
}
