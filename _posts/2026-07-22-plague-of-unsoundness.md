---
layout: post
title: The Plague of Unsoundness
---

# The Plague of Unsoundness

## Introduction

Unsound type systems make me upset.

Back when I worked in a Ruby on Rails codebase, we implemented a lot of calculations and elaborate data pipelines. 4-5 distinct entry points all for processing a similar data structure in slightly nuanced ways; the data being composed of nested arrays of vector-like structs of nullable bignums and whatnot, transformed into hashes, merged, reduced, etc., to ultimately produce something like an array of database records... You can imagine doing this kind of thing in Ruby required a **lot** of tests to have any faith in correct behavior. And writing good tests was hard. The fixtures alone took probably a couple hundred lines to define.

Despite doing our best, we still had to routinely deal with runtime type errors, most commonly due to missing `nil` checks. Each fix came with an appropriate addition of a test case, of course, whenever it was possible. I'm sure we rewrote some of the test suites a couple times too, trying to approach them more methodically, to construct and specify every possible case. At no point did I ever really feel like we were _done_ and that the implementation was now entirely reliable.

Knowing the requirements today and allowed to start from scratch, I have no doubt we would have picked a statically typed language, at the very least for the purposes of data processing and calculations. It's easy to brush off the flaws of dynamic type systems and tell people to write good tests. But my humble opinion is that static typing provides much more value than tests do. And I think people still tend to underestimate it, especially in environments where static typing is not the norm, but an afterthought, often a post-hoc band-aid.

Fortunately, people do seem to have been coming to terms with this in the recent decade or so. Not so fortunately, the gradual process has left the state of static typing in most languages burdened with numerous historical compromises, often set in stone for backwards compatibility reasons, as well as compromise-oriented mindsets.

In my previous post I wrote a bit about static analysis in Ruby. I want to dive deeper into a specific issue I once discovered in Sorbet that has led me to discover a puzzling rabbit hole of language design flaws.

## Arrays of Whatever

Take the humble array.

Most imperative languages today implement an array (_vector_, _list_, _array list_, whatever) as a mutable, generic data structure.

A generic type is of course a type that is _parameterized_ by other types. Most commonly, but not exclusively, these type parameters describe values contained within the generic type and thus allow strict static analysis and reasoning about container data structures.

You would think such a common, simple type as an array would have well-defined, proven typing rules, even with generics. Surely, in the year 2026 we can have sound type-checking for arrays and not worry about runtime type errors. Well, this is TypeScript:

```typescript
type AudioClip = { channels: number, sampleRate: number };
type VideoClip = { widthPx: number, heightPx: number };
type Clip = AudioClip | VideoClip;

const pushClip = (clips: Clip[]) => {
  clips.push({ widthPx: 480, heightPx: 720 } satisfies VideoClip);
};

const totalSamplesPerSecond = (clip: AudioClip) =>
  clip.channels * clip.sampleRate;

const audioClips: AudioClip[] = [{ channels: 2, sampleRate: 44100 }];
pushClip(audioClips); // ???

for (const clip of audioClips) {
  console.log(totalSamplesPerSecond(clip)); // 88200, NaN
}
```

[^1]

Great. Not only does this falsely type check, it silently produces an absurd output of `NaN` samples per second for the stray `VideoClip`. All this with TypeScript's _strict_ flag, mind you.

I had known for a long time that this was thing. I naively hoped that this was just a TypeScript quirk, among many others. But then I started using [Sorbet](https://sorbet.org):

```ruby
sig { params(objects: T::Array[Object]).void }
def push_object(objects)
  objects << Object.new
end

ints = T.let [1, 2, 3], T::Array[Integer]
push_object(ints) # ???
puts ints.sum
```

This also passes the type checker just fine. Ruby is at least sane enough to throw a runtime error:

```
Object can't be coerced into Integer (TypeError)
```

But man, does this irk me.

While researching this I also checked out the main alternative to Sorbet which is [RBS](https://github.com/ruby/rbs) & [Steep](https://github.com/soutaro/steep), thinking maybe they did it right. Unfortunately, the same issue presents there:

```ruby
class Unsound
  #: (Array[Object]) -> void
  def self.push_object(objects)
    objects << Object.new
  end
end

ints = [1, 2, 3] #: Array[Integer]
Unsound.push_object(ints) # ???
puts ints.sum
```

_Note: I'm using [rbs-inline](https://github.com/soutaro/rbs-inline), which is why the wrapper class is required._

I was going to praise Java, of all things, for how it does this right. It does make some good decisions that make it stand out from all the previous examples, as I'll explain later. Unfortunately, while researching this post, I found out that it beats the record with only 3 statements it takes to produce a false type-check:

```java
Integer[] ints = new Integer[1];
Object[] objects = ints;
objects[0] = new Object();
```

Why is this a thing? It's not hard to find documentation on this.

- [Sorbet](https://sorbet.org/docs/stdlib-generics#standard-library-generics-and-variance)
- [RBS](https://github.com/ruby/rbs/blob/master/docs/syntax.md#generics)
- [TypeScript](https://github.com/microsoft/TypeScript/issues/9825#issuecomment-234115900)
- [Java](https://docs.oracle.com/javase/8/docs/api/java/lang/ArrayStoreException.html)
- [C#](https://learn.microsoft.com/en-us/dotnet/api/system.arraytypemismatchexception?view=net-10.0)

It at least supposedly shows that these decisions were made intentionally. Sorbet docs state the following:

> This makes it easy to get the most common Ruby usage patterns to type check without jumping through hoops.

I will get back to this theme of _pragmatism_ and the proposition or implication that type checking generics properly would require some kind of unwiedly gymnastics.

But worse, it states:

> Sorbet is not the only type system to implement covariant arrays. Notably: TypeScript uses the same approach.

TypeScript (Ryan Cavanaugh):

> There's no such thing as a sound, simple, useful type system.

The comment goes into more detail but basically distills down to:
- language users would have more work to do,
- the type checker would be slower.

Lastly, RBS says this:

> If an Array of String is passed to a method as an Array of Object, and that method adds an Integer to the Array, the promise is broken.
>
> In those cases, one must use the `unchecked` keyword.

As a side note, I think this might actually be the worst solution of all :D

## Variance

This issue with generics and variance specifically seems to be the most pervasive throughout various languages. It's usually not specific to arrays but evidence of a more general type system limitation. It's also the one that I find most interesting and potentially remediable, so I'll focus on it here.

I want to try and better explain what's going on, also to better my own understanding. But I must make a disclaimer that my expertise in this topic is entirely non-academic and not backed by any serious experience in type theory research. I'll just give my layman's explanation to keep the post self-contained for those who are not familiar with the terminology.

_Variance_ of generic types defines _subtyping_ rules in relation to the subtyping rules of their type parameters. A relation of relations, if you will.

For example, in TypeScript, a type `Apple[]` is defined to be a **subtype** of `Fruit[]`, given that `Apple` is a subtype of `Fruit`. This is the most obvious kind of variance called _covariance_. Importantly, in TypeScript, this relation is inherent to the array type. This is what Sorbet documentation is refering to when it mentions _covariant arrays_.

Conversely, the function type `(_: Apple) => void` is a **supertype** of `(_: Fruit) => void`. Intuitively, any function that takes an `Apple` is also a function that takes a `Fruit`, but not necessarily the other way around. This is called _contravariance_.

Interestingly, the function type is simultaneously covariant over its return type, e.g. `() => Apple` is a **subtype** of `() => Fruit`.

_Note: I'm not sure this is 100% consistent in TypeScript and can't be bothered to fully test this. Think of it as pseudo-code for explanatory purposes._

_Also, variance is typically described in terms of a `<:` relation which is reflexive, meaning `T <: T` for all `T`, i.e. any type is a "subtype" of itself. This may not be implicitly obvious from usage of the word "subtype"._

Covariance can intuitively be thought of as the default variance on (immutable) container types or _producers_ of values, whereas contravariance would typically be used for _consumers_ of values. You will commonly see notation like `out T` and `in T` in some languages like C# which is analogous to this.

Notice that contravariance is actually what we would prefer for an argument to a function like `(_: Fruit[]) => void` in which we intend to push to the array. The array is expected to _consume_ a `Fruit`, so the element type must either be exactly `Fruit` or a _more general_ type, definitely not a _subtype_ of `Fruit`.

But alas, in TypeScript, Sorbet, RBS-based checkers, and likely many other systems, we cannot change the fact that the array type itself is defined as covariant over the element type.

## On the Right Track

Perhaps this is controversial, but I think Java implements very competent generics, probably the best I've worked with in an OOP language.

Aside from the unfortunate array example, a comprehensive paper[^4] I found on Java's unsoundness seems to primarily rely on the property that `null` inhabits certain problematic and otherwise uninhabitable types. There's interestingly also another paper[^5] as a response to the former, supposedly suggesting a complete solution. All in all, I feel like if not for these two issues, Java would serve as a great example of how to do object-oriented generics right.

The main characteristic I attribute this to is _use-site variance_[^2][^3]. In simple terms, it's the decision to allow generic type variance to _vary_ depending on how the type is **used**, instead of being inherent to the type itself.

By default, generic types are invariant in Java, meaning for example you cannot implicitly assign an `ArrayList<A>` to an `ArrayList<B>`, even if `A extends B`. You also cannot declare variance on the type itself as in other languages (_declaration-site variance_). In order to allow subtyping in method calls you are therefore required to explicitly define variance per-method.

```java
class Variance {
    static void pushObject(ArrayList<? super Object> objects) {
        objects.add(new Object());
    }

    public static void main(String[] args) {
        ArrayList<Integer> ints = new ArrayList<>(List.of(1, 2, 3));
        pushObject(ints); // error
    }
}
```

This correctly fails type checking, because the `pushObject` method (as well as `ArrayList::add`) specifies the type of the list as contravariant over the element type. It's allowed to do this since neither the type `ArrayList`, nor any other generic type, is allowed to impose an inherent variance as part of its declaration.

_Note: Java's wildcards are actually in some ways distinct from typical variance annotations, namely utilizing a system called capture conversion, but I don't think that's relevant here._

There's also been some research[^6] suggesting alternative notation like `+T` and `-T` corresponding to Java's `? extends T` and `? super T` respectively.

What could this look like for a language like Ruby?

```ruby
#: (Array[-Object]) -> void
def self.push_object(objects)
  objects << Object.new
end

ints = [1, 2, 3] #: Array[Integer]
push_object(ints) # error
```

Or using Sorbet's syntax:

```ruby
sig { params(objects: T::Array[-Object]).void }
def self.push_object(objects)
  objects << Object.new
end
```

`Array[-Object]` here would indicate contravariance, meaning _an array whose element type is a supertype of `Object`_, i.e. `Array[T]` where `T >= Object`. Since `Integer < Object`, the function call would not type check.

Wouldn't this be beautiful?

It's also worth giving C# an honorable mention here, because while it also uses declaration-site variance, it does so in an interesting way where read and write methods on generic containers are supposedly segragated into separate interfaces, one being covariant (`out T`) and the other contravariant (`in T`). This again doesn't apply to the `T[]` array type where C# exhibits the same flaw as Java. I don't have experience with C# so I can't say much about how this works out in practice, but in theory it sounds like it should be able to achieve the same goal, only a bit less elegantly in my opinion.

## Conclusion

Ultimately, the only _pragmatic_ thing about the array variance compromise I am currently willing to acknowledge is a reduced scope of work for the compiler implementation team. I wish there was more initiative and care out there among language designers to have the courage to avoid these types of issues. There are definitely performance implications for more complex type checkers, but seeing as Java compiles its wildcard generics in reasonable time for most common uses, I don't think this is realistically an issue and a valid argument that would warrant completely dismissing the idea.

Researching this you may also stumble upon mentions of the fact that implementing soundness for generic type systems is _undecidable in the general case_. This is true; with sufficient type gymnastics, the type checker can be put into a state where it will recurse indefinitely and never reach a solution. I don't think this is a good argument either. I won't try making an argument based on the frequency/rarity of these undecidable cases, because it's the same type of argument often used to justify the aforementioned compromises. I will, however, point out that undecidable generics will at worst result in **false negatives** as opposed to **false positives**. Moreover, type checkers will typically implement restrictions to avoid problems like non-termination in practice.

I would rather have my type checker hang than let me push a `Fruit` to an array of `Apple`. Because the former is a rare bug I will notice and report, while the latter is a rare **silent** error that will potentially cost me hours of work.

I also get that you have to draw the line _somewhere_ between pragmatism and perfectionism. I am not demanding, nor do I wish for all languages to be turned into rigorous, formally provable systems. It's just that I find the current state of this line much lower than necessary. Looking into issues like these, I can't help but wonder---is the supposed convenience really worth the cost, or is the pragmatism just an excuse?

At the end of the day, this post isn't a well-prepared attempt at convincing anyone one way or the other, only the expression of a personal sentiment and an exploration.

Lastly, I've been on the fence about this for a while now, but I think I'm now willing to try my luck implementing a type checker which solves these issues properly. Try and stop me :)

[^1]: [_The Seven Sources of Unsoundness in TypeScript: The thing with variance and arrays,_ Effective TypeScript](https://effectivetypescript.com/2021/05/06/unsoundness/#The-thing-with-variance-and-arrays)
[^2]: [_Declaration-site and use-site variance explained,_ Schneide Blog](https://schneide.blog/2015/05/11/declaration-site-and-use-site-variance-explained)
[^3]: [_Type Variance: Comparing declaration-site and use-site annotations_, Wikipedia](https://en.wikipedia.org/wiki/Type_variance#Comparing_declaration-site_and_use-site_annotations)
[^4]: [Nada Amin and Ross Tate (2016). _Java and Scala’s Type Systems are Unsound_](https://io.livecode.ch/learn/namin/unsound)
[^5]: [Kevin Bierhoff (2022). _Wildcards Need Witness Protection_](https://dl.acm.org/doi/pdf/10.1145/3563301)
[^6]: [Atsushi Igarashi and Mirko Viroli (2004). _Variant Parametric Types: A Flexible Subtyping Scheme for Generics_](https://web.archive.org/web/20060518003929id_/http://www.sato.kuis.kyoto-u.ac.jp:80/~igarashi/papers/pdf/variance.TOPLAS.pdf)
