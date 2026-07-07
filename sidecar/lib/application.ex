defmodule ReactableSidecar.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    # Nexus is a permanent release application; keep a trivial supervisor alive.
    Supervisor.start_link([], strategy: :one_for_one, name: ReactableSidecar.Supervisor)
  end
end
