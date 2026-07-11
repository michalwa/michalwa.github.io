---
layout: post
title: Designing a Database for a Prolog-based PKM Application
---

# Designing a Database for a Prolog-based PKM Application

![factbook screenshot](https://raw.githubusercontent.com/michalwa/factbook/main/screenshot-dark.png)

## Introduction

[factbook](https://github.com/michalwa/factbook) is a minimalist PKM app I've been working on for the past few months as a hobby project. It's written in [Rust](https://rust-lang.org) using [Tauri](https://tauri.app) and [Solid.js](https://www.solidjs.com) for the UI. Its workflow resembles Zettelkasten---small, atomic entries and heavy use of tags which emerge organically. What makes it unique is that all organization logic is entirely delegated to a user-facing scripting layer built on top of Prolog.

[Prolog](https://www.metalevel.at/prolog) is a logic programming language. Aside from being 100% Turing-complete, logic problems and relational search are where it really shines. The interpreter is pretty much a first-order logic solver and has built-in concepts of _choice points_, _backtracking_, etc. The language also relies heavily on the concept of _unification_, which can be thought of as a form of _pattern matching_, which makes it really easy to express very complex nested relations within data structures. It has many similarities to the LISP family---although it doesn’t use S-expressions, its design very much follows the spirit of _code as data_.

If you're unfamiliar with logic programming and are open to exploring new, foreign paradigms of thinking I encourage you to investigate further. Prolog has defined a completely new perspective on many concepts in both programming and mathematics for me. I think people usually get introduced to Prolog in an academic setting, but I just stumbled upon it one day in my spare time and got hooked.

The way factbook attempts to take advantage of this technology is by allowing users to tag their entries with arbitrary Prolog _terms_. In short, this means instead of simple tags like `#book` or `#task`, you can write `@book([read(false), rating(3)])`, meaning you can pretty much embed arbitrary data structures into your notes, which I think is pretty cool. Prolog's minimalist syntax makes it quite clean and readable too, as opposed to using something obvious like JSON.

The way you can then reason about these tags is by means of queries (_views_), which are made to look more or less like a subset of Prolog, giving you pretty much the entire language at your disposal, with some domain-specific/quality-of-life features added on top.

I would often find myself using PKM/note-taking apps in elaborate, over-engineered ways. And sometimes they just weren't enough or didn't feel right, which is how I came up with the idea once I got [more or less comfortable using Prolog](https://github.com/michalwa/aoc-2025). It just seemed like a fun project to work on potentially leading to an actual usable product, or at least usable by me&nbsp;:) I won't pretend like the main reason I'm building this thing isn't just because it's fun to think about.

I'm not aware of any similar attempts, although similar tools in general do exist. Most noteworthy probably being Emacs Org Mode, which I'm planning to study at some point.

## The problem

Let me first show you an example of how the app is designed to work. Here’s what a _journal_ in factbook might look like. Entries are numbered for later reference; in the actual app they are annotated with timestamps.

```
0 | @todo(false) this is an uncompleted task
1 | @todo(true) this is a completed task
2 | this is a @todo(false) in the context of @work
3 | this is a @thought where I want to @cite("Einstein", 1905)
4 | another @thought
5 | some research @cite("Turing", 1936)
```

Now, say you want to list all uncompleted tasks. You would simply use the query: `@todo(false)`. Want to see all tasks regardless of completion? Put an unbound variable as the argument: `@todo(_)`. Of course, there’s also boolean operators: conjunction (`,`) and disjunction (`;`), so you can say things like `@todo(false); @thought, @cite(_, _)` (_uncompleted tasks or thoughts which cite something_).

There’s also other predicates which don’t refer to tags. For instance, you can reason about the creation times of entries (`created(_)`); or execute completely arbitrary Prolog code (`{ ... }`). This naturally includes accessing the file system or making web requests, not that you should necessarily do those things.

Evaluating these kinds of queries in Prolog on its own is trivial. However, it requires that the associations between entries and their tags are available to the Prolog runtime. How can we store this data in a way that is maintainable, efficient to mutate, and available to the Prolog runtime?

## The easy solution

Prolog maintains a database which you normally populate with a program ahead of time and subsequently query (or evaluate _goals_). Let’s see what our example entry database could look like written as a Prolog program:

```prolog
entry_tag(0, todo(false)).
entry_tag(1, todo(true)).
entry_tag(2, todo(false)).
entry_tag(2, work).
entry_tag(3, thought).
entry_tag(3, cite("Einstein", 1905)).
entry_tag(4, thought).
entry_tag(5, cite("Turing", 1936)).
```

I make the rather obvious assumption here that we're interested in storing _parsed tags_ and not _entry content_ to avoid having to parse each entry during search. I leave storage of entry content as a separate question for now, though it would definitely be nice to arrive at a solution which also accounts for it.

The above list of _facts_ defines the predicate `entry_tag/2` (standard notation, `/2` indicates arity) which associates an entry ID with a tag included in the entry. To then retrieve IDs of entries containing the `todo/1` tag, for example, we could use the following Prolog query: `?- entry_tag(E, todo(_))`.

But say we change the content of entry `0` from "_@todo(false) this is an uncompleted task_" to "_@todo(true) this is a completed task_". How can we update the Prolog database accordingly? Nuking the entire runtime and initializing a new one with a new state after every change won't do. So what else can we do?

Well, it turns out you can declare facts and rules at "query time" using `asserta/1` and `assertz/1`. These are special built-in predicates, which you can query just like other predicates, including as part of rules, but have the side effects of either prepending or appending facts or rules to the database. There are also a bunch of related predicates for retracting clauses from the database.

Going back to our example.

To be safe we would probably need to first retract all facts about that entry:

```prolog
retract(entry_tag(0, _)).
```

And subsequently assert the facts corresponding to each of the new tags:

```prolog
assertz(entry_tag(0, todo(true))).
```

If the entry got deleted as a whole, we would only do the retraction.

At startup, we would of course have to parse all entries, serialize the ID-tag pairs into Prolog clauses and pass them to the interpreter.

This might seem like a perfect solution at first glance and, to be fair, I have not honestly tested this and verified its performance. It could turn out that for small sets of entries it’s completely viable. However, I immediately got a strong gut feeling that this would not be the way to go.

In a professional setting, I would probably go through the effort of actual prototyping to have concrete measurements to base my judgment on. In my personal project I get to skip that part. Let me try to explain why I felt this way:

- Having to manage state through the Prolog interpreter is cumbersome. All mutations have to go through this layer instead of being written in plain Rust, or even worse, Prolog has to be kept in sync with other external data structures.
- I make actual performance judgments warily, having skipped actual benchmarking, but I reckon the universal nature of the dynamic database must ultimately prove worse than a custom store tailored to the specifics of how the application operates.
- In any case, relying on the Prolog database gives limited to no control over the way data is stored. Any future memory/time optimizations would be dependent on the specifics of the Prolog implementation. Prolog implementations do make certain guarantees about search performance and ways to improve it from user code, but still set certain inherent constraints.
- From an architectural perspective, tying the performance of data storage to Prolog does not seem ideal either, even though the data we're dealing with here is more of a search cache. I would like Prolog to be scoped to only the functionality it is specifically intended to enable in the application.
- In the near future I would also like to implement things like full-text search integrated into the query interface. I doubt this can be implemented reliably and efficiently in Prolog, and so it will most likely need a native implementation. It would then be nice to keep indexing text consistent with indexing terms, perhaps even reusing certain components between them.

## Setup

The way you interface with the Prolog interpreter is split into two aspects:

**Constructing terms:** This is done with functions like `PL_put_atom` or `PL_put_functor`, which you call "bottom-up" to construct your term trees. In my [Rust wrapper](https://github.com/michalwa/factbook/tree/main/factbook-swipl) around SWI-Prolog I have a macro which allows me to do this more conveniently. You can also simply delegate parsing to the interpreter using `PL_put_term_from_chars`, with some limitations. The one crucial use of this is for constructing the query term (_goal_).

**Calling Rust from Prolog:** This is where the magic happens. You can register _foreign predicates_ in the Prolog runtime pointing to native implementations that will be called to obtain solutions. The implementations are free to emulate all of the properties of regular predicates.

There are generally several _modes_ of predicates, the two which are relevant here being _semi-deterministic_ and _non-deterministic_. The former are allowed either to fail or to succeed exactly once (producing a single solution). The latter may succeed an arbitrary number of times, producing alternative solutions. Our earlier definition of `entry_tag/2` is an example of a non-deterministic predicate, since for certain arguments (even fully instantiated, as entries may contain duplicate tags) it may yield more than one solution.

In my wrapper, I have two traits describing this (simplified):

```rust
trait Semidet {
    fn call(args: &[Term]) -> bool;
}

trait Nondet {
    fn init() -> Self;
    fn next(&mut self, args: &[Term]) -> bool;
}
```

As you can see, non-deterministic predicates are allowed to construct a state and mutate it upon each invocation during search.

Terms, on the other hand, may contain arbitrary blobs of bytes, meaning we can actually embed references to some native state into the goal term and pass it down to our foreign predicate implementation. The wrapper defines a bunch of blob types which allow doing this with proper Rust borrow checking.

The predicate implementation may then construct its internal state which can hold those references and allow each subsequent invocation to read our native application state.

Altogether, this lets us construct the core infrastructure that will allow us to implement any kind of search natively in Rust and make it available to Prolog.

![architecture diagram](/assets/images/factbook-search-arch.svg)

## So far so good

Okay, but we are left with actually implementing the storage and search.

Let’s first assume our native predicate will have a similar signature to what we initially sketched out, meaning: `entry_tag(Id, Tag)`. Since we know we’ll have to pass external context, let’s also include that as an argument: `entry_tag(Ctx, Id, Tag)`. This context will include a reference to the actual storage of entires, as well as any indexes or caches we decide to maintain for support.

Using my Rust wrapper crate, you can specify this as follows:

```rust
#[derive(ScopedBlobData)]
struct Context<'a>(&'a /* some internal storage type */);

#[predicate(entry_tag(ctx, id, tag) nondet)]
struct EntryTag { /* ... */ }

impl Nondet for EntryTag {
    /* ... */
}
```

When the user submits a query, we want to:
1. Wrap references to application state in a `Context` blob.
1. Construct the query term (goal) with the following arguments:
  - the newly constructed `Context` blob,
  - the user's query,
  - an unbound variable which will be unified with matching entry IDs.
1. Evaluate the query and collect the resulting entry IDs.

There is still the question of translating the custom _view language_ into a Prolog query. In factbook this is implemented on the Prolog side as a regular predicate taking the _view_ as an argument and invoking the foreign predicate when necessary.

Let’s now think about some example invocations of the predicate and what they should return:

```prolog
entry_tag(_, E, thought). % context blob is omitted here
```

This should yield solutions for `E` where the entry contains the tag `@thought`. In our example, that would be `E = 3` and `E = 4`.

Given a list of entries and tags, you can imagine having a simple inverted index by tag names to efficiently traverse entries sharing the same tag. This gives us our first clue for what the implementation should look like.

```rust
struct Database {
    entries: BTreeMap<EntryId, Entry>,
    tags: Vec<(EntryId, Tag, TagData)>,
    tag_indices: BTreeMap<Tag, Vec<usize>>,
}

#[derive(ScopedBlobData)]
struct Context<'a>(&'a Database);

#[predicate(entry_tag(ctx, id, tag) nondet)]
struct EntryTag {
    iter: Option<Box<dyn Iterator<Item = (EntryId, TagData)>>>,
}

impl Nondet for EntryTag {
    fn init() -> Self {
        Self { iter: None }
    }

    fn call(&mut self, [ctx, id, tag]: &[Term]) -> bool {
        // extract `Context` from `ctx`

        if self.iter.is_none() {
            // initialize iterator based on `tag`
        }

        for (entry, tag) in self.iter.as_mut().unwrap() {
            if /* unify with `id` and `tag` */ {
                return true;
            }
        }

        false
    }
}
```

Note that because we allow arbitrary data to be used inside tags, including strings, numbers, and the like, we probably want a way to construct keys for these terms which represent their general structure, rather than concrete values. This is represented by the `Tag` type in the snippet above, as opposed to `TagData` which would store the actual concrete value of a tag.

In cases where the tag is a compound term, we can simply use the functor as the index:

```prolog
entry_tag(_, E, todo(_)). % search by `todo/1`
```

We could also choose to index based on a predetermined number of initial arguments, or allow users to choose their own indexing strategies based on the intended usage of the tags, etc.

So far so good, but imagine you have a query even slightly more complex than a single tag predicate:

```
@thought, @cite(_, _)
```

The predicate invocation would look like this:

```prolog
entry_tag(C, E, thought), entry_tag(C, E, cite(_, _)).
```

Without any additional optimizations, we suddenly arrive at quadratic time complexity. For each solution yielded by the first invocation of `entry_tag`, Prolog will invoke the second one and the implementation will in turn attempt to unify each of its solutions with the solution yielded from the first invocation.

Here’s a visualization of this using our initial example journal:

```
?- entry_tag(C, E, thought).
   index search yields `E = 3` and `E = 4`
     ?- entry_tag(C, 3, cite(_, _)).
        index search yields `E = 3` and `E = 5`
          ?- 3 = 3. true
          ?- 3 = 5. false
     ?- entry_tag(C, 4, cite(_, _)).
        index search yields `E = 3` and `E = 5`
          ?- 4 = 3. false
          ?- 4 = 5. false
```

In this example 4 cases were tested only for 1 to result in a valid solution: `E = 3`

An easy first optimization is to traverse entries instead of tags when possible. We can simply detect whether `entry_tag` is called with an already unified ID argument, and then choose to iterate over other tags in the same entry instead of all entries matching the tag. This should be much better, because entries will realistically contain much fewer tags than there will be entries matching that tag.

```rust
impl Nondet for EntryTag {
    fn call(&mut self, [ctx, id, tag]: &[Term]) -> bool {
        // ...

        if self.iter.is_none() {
            if let Some(id) = id.get::<EntryId>() {
                // initialize iterator based on `id`
            } else {
                // initialize iterator based on `tag`
            }
        }

        // ...
    }
}
```

The search should then look something like this:

```
?- entry_tag(C, E, thought).
   index search yields `E = 3` and `E = 4`
     ?- entry_tag(C, 3, cite(_, _)).
        entry contains tags `thought` and `cite("Einstein", 1905)`
          ?- cite(_, _) = thought. false
          ?- cite(_, _) = cite("Einstein", 1905). true
     ?- entry_tag(C, 4, cite(_, _))
        entry contains tags `thought`
          ?- cite(_, _) = thought. false
```

So the index search helps us narrow down the initial search space, but then we fall back to linear scans assuming realistically smaller data sets.

This is actually the way the predicate is designed and implemented at the time of writing this article. It strikes a good balance between implementation simplicity (if you can call it that) and performance. It hasn't been stress-tested against large datasets nor properly benchmarked and this is something I'm not planning to do anytime soon, because I don't expect the app to be used heavily by anyone in the near future :) Most of what I talk about here are ahead-of-time optimizations, you could maybe argue premature. Still, they are not arbitrary, as I try to think what kind of workloads can be reasonably expected given the application's design.

## Taking it further

The solution is of course still suboptimal for certain imaginable use cases. Namely, for a conjunction query like in the example above, the two tags may only share a small subset of associated entries, in which case the first specified tag will determine the time it takes to find them, performing a lot of wasted iterations. Ideally we would want to optimize finding solutions for arbitrary boolean expressions.

This is obviously the opening of a huge rabbit hole, one I will surely be tempted to explore in the near future.
