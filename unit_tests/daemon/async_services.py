"""Async HTTP facades for synchronous, same-thread domain test fixtures."""


class AsyncService:
    def __init__(self, service):
        self.service = service

    def __getattr__(self, name):
        async def call(*args, **kwargs):
            return getattr(self.service, name)(*args, **kwargs)

        return call


async def resolve_test_plan(run_id):
    return "plan"
