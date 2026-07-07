defmodule ReactableSidecar.MixProject do
  use Mix.Project

  @nexus_path Path.expand(
                System.get_env("NEXUS_PATH") || "../../../../workbooks/nexus",
                __DIR__
              )

  def project do
    [
      app: :reactable_sidecar,
      version: "0.1.0",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      releases: releases(),
      default_release: :reactable_sidecar
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {ReactableSidecar.Application, []}
    ]
  end

  defp deps do
    [
      {:nexus, path: @nexus_path},
      {:burrito, "~> 1.0", runtime: false}
    ]
  end

  defp releases do
    [
      reactable_sidecar: [
        steps: [:assemble, &Burrito.wrap/1],
        applications: [nexus: :permanent, reactable_sidecar: :permanent],
        burrito: [
          targets: [
            macos_silicon: [os: :darwin, cpu: :aarch64]
          ]
        ]
      ]
    ]
  end
end
