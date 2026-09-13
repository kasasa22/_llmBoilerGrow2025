interface JobBadgeProps {
  jobId: string | null;
}

export function JobBadge({ jobId }: JobBadgeProps) {
  if (!jobId) return null;
  return (
    <span className="badge job-badge" title={`job_id: ${jobId}`}>
      {jobId}
    </span>
  );
}
